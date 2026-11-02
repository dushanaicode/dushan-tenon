//! 有序的进程内流；传输适配器由宿主提供。
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use crate::{
    actor::Actor,
    error::{AppError, ErrorCode, INTERNAL_UNEXPECTED},
    id::Id,
};

pub const STREAM_CLOSED: ErrorCode = ErrorCode::new("app.stream.closed");
pub const STREAM_FORBIDDEN: ErrorCode = ErrorCode::new("app.stream.forbidden");

pub type StreamParams = BTreeMap<String, String>;

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamCancel {
    pub stream_id: Id,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StreamEvent<T> {
    Started {
        stream_id: Id,
    },
    Delta {
        #[ts(type = "number")]
        seq: u64,
        data: T,
    },
    Progress {
        #[ts(type = "number | null")]
        current: Option<i64>,
        #[ts(type = "number | null")]
        total: Option<i64>,
        message_key: Option<String>,
        #[ts(type = "Record<string, string>")]
        params: StreamParams,
    },
    Succeeded {
        data: Option<T>,
    },
    Failed {
        code: String,
        #[ts(type = "Record<string, string>")]
        params: StreamParams,
    },
    Cancelled,
    Unknown {
        reason: String,
    },
}

/// 同步按序接收事件；适配器必须返回错误而不能 panic，也不能重入同一流。
/// 发送在流状态锁内执行；调用方不能依赖底层 source，流会将其丢弃。
pub trait StreamSink<T>: Send + Sync {
    fn send(&self, event: StreamEvent<T>) -> Result<(), AppError>;
}

#[derive(Clone, Default)]
pub struct StreamRegistry(Arc<Mutex<RegistryState>>);

#[derive(Clone, PartialEq, Eq)]
pub struct StreamOwner {
    pub actor: Actor,
    pub scope: String,
}

#[derive(Default)]
struct RegistryState {
    closed: bool,
    entries: BTreeMap<Id, Registration>,
}

struct Registration {
    owner: StreamOwner,
    cancellation: CancellationToken,
}

impl StreamRegistry {
    pub fn open<T>(
        &self,
        owner: StreamOwner,
        sink: impl StreamSink<T> + 'static,
    ) -> Result<Stream<T>, AppError> {
        let id = Id::new();
        let cancellation = CancellationToken::new();
        {
            let mut registry = self
                .0
                .lock()
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
            if registry.closed {
                return Err(AppError::new(STREAM_CLOSED));
            }
            registry.entries.insert(
                id,
                Registration {
                    owner,
                    cancellation: cancellation.clone(),
                },
            );
        }
        let stream = Stream {
            id,
            cancellation,
            registry: self.clone(),
            sink: Box::new(sink),
            state: Mutex::new(StreamState {
                seq: 0,
                ended: false,
            }),
        };
        stream.emit(StreamEvent::Started { stream_id: id }, false)?;
        Ok(stream)
    }

    pub fn cancel(&self, owner: &StreamOwner, id: Id) -> Result<(), AppError> {
        if let Some(entry) = self
            .0
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .entries
            .get(&id)
        {
            if &entry.owner != owner {
                return Err(AppError::new(STREAM_FORBIDDEN));
            }
            entry.cancellation.cancel();
        }
        Ok(())
    }

    pub fn cancel_scope(&self, scope: &str) -> Result<(), AppError> {
        self.0
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
            .entries
            .retain(|_, entry| {
                if entry.owner.scope == scope {
                    entry.cancellation.cancel();
                    false
                } else {
                    true
                }
            });
        Ok(())
    }

    pub fn close(&self) -> Result<(), AppError> {
        let mut registry = self
            .0
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        registry.closed = true;
        for entry in registry.entries.values() {
            entry.cancellation.cancel();
        }
        registry.entries.clear();
        Ok(())
    }
}

struct StreamState {
    seq: u64,
    ended: bool,
}

pub struct Stream<T> {
    pub id: Id,
    pub cancellation: CancellationToken,
    registry: StreamRegistry,
    sink: Box<dyn StreamSink<T>>,
    state: Mutex<StreamState>,
}

impl<T> Stream<T> {
    fn emit(&self, event: StreamEvent<T>, terminal: bool) -> Result<(), AppError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        self.send(&mut state, event, terminal)
    }

    fn send(
        &self,
        state: &mut StreamState,
        event: StreamEvent<T>,
        terminal: bool,
    ) -> Result<(), AppError> {
        if state.ended {
            return Ok(());
        }
        let (event, terminal) = if !terminal && self.cancellation.is_cancelled() {
            (StreamEvent::Cancelled, true)
        } else {
            (event, terminal)
        };
        let result = self.sink.send(event).map_err(|error| AppError {
            code: error.code,
            params: error.params,
            source: None,
        });
        if terminal || result.is_err() {
            state.ended = true;
            self.cancellation.cancel();
            self.registry
                .0
                .lock()
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?
                .entries
                .remove(&self.id);
        }
        result
    }

    pub fn delta(&self, data: T) -> Result<(), AppError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let seq = state.seq;
        self.send(&mut state, StreamEvent::Delta { seq, data }, false)?;
        if !state.ended {
            state.seq += 1;
        }
        Ok(())
    }

    pub fn progress(
        &self,
        current: Option<i64>,
        total: Option<i64>,
        message_key: Option<String>,
        params: StreamParams,
    ) -> Result<(), AppError> {
        self.emit(
            StreamEvent::Progress {
                current,
                total,
                message_key,
                params,
            },
            false,
        )
    }
    pub fn succeeded(&self, data: Option<T>) -> Result<(), AppError> {
        self.emit(StreamEvent::Succeeded { data }, true)
    }
    pub fn failed(&self, code: String, params: StreamParams) -> Result<(), AppError> {
        self.emit(StreamEvent::Failed { code, params }, true)
    }
    pub fn cancelled(&self) -> Result<(), AppError> {
        self.emit(StreamEvent::Cancelled, true)
    }
    pub fn unknown(&self, reason: String) -> Result<(), AppError> {
        self.emit(StreamEvent::Unknown { reason }, true)
    }
}

impl<T> Drop for Stream<T> {
    fn drop(&mut self) {
        self.cancellation.cancel();
        match self.registry.0.lock() {
            Ok(mut registry) => {
                registry.entries.remove(&self.id);
            }
            Err(_) => tracing::error!("流析构时注册表锁中毒"),
        }
    }
}

#[cfg(test)]
mod tests;

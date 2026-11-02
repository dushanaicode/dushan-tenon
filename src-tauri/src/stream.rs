use tenon_framework::{
    error::{AppError, INTERNAL_UNEXPECTED},
    stream::{StreamEvent, StreamSink},
};

pub struct ChannelSink<T>(pub tauri::ipc::Channel<StreamEvent<T>>);

impl<T: serde::Serialize + Send + Sync> StreamSink<T> for ChannelSink<T> {
    fn send(&self, event: StreamEvent<T>) -> Result<(), AppError> {
        self.0
            .send(event)
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
    }
}

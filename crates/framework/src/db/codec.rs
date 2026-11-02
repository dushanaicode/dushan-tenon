use sqlx::{Database, Decode, Encode, Type, encode::IsNull, error::BoxDynError};

use crate::{id::Id, time::Timestamp};

impl From<Id> for sea_query::Value {
    fn from(value: Id) -> Self {
        value.to_string().into()
    }
}

impl<DB: Database> Type<DB> for Id
where
    String: Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <String as Type<DB>>::type_info()
    }

    fn compatible(info: &DB::TypeInfo) -> bool {
        <String as Type<DB>>::compatible(info)
    }
}

impl<'q, DB: Database> Encode<'q, DB> for Id
where
    String: Encode<'q, DB>,
{
    fn encode_by_ref(&self, buffer: &mut DB::ArgumentBuffer) -> Result<IsNull, BoxDynError> {
        self.to_string().encode(buffer)
    }
}

impl<'r, DB: Database> Decode<'r, DB> for Id
where
    String: Decode<'r, DB>,
{
    fn decode(value: DB::ValueRef<'r>) -> Result<Self, BoxDynError> {
        Ok(String::decode(value)?.parse()?)
    }
}

impl From<Timestamp> for sea_query::Value {
    fn from(value: Timestamp) -> Self {
        value.as_millis().into()
    }
}

impl<DB: Database> Type<DB> for Timestamp
where
    i64: Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <i64 as Type<DB>>::type_info()
    }

    fn compatible(info: &DB::TypeInfo) -> bool {
        <i64 as Type<DB>>::compatible(info)
    }
}

impl<'q, DB: Database> Encode<'q, DB> for Timestamp
where
    i64: Encode<'q, DB>,
{
    fn encode_by_ref(&self, buffer: &mut DB::ArgumentBuffer) -> Result<IsNull, BoxDynError> {
        self.as_millis().encode(buffer)
    }
}

impl<'r, DB: Database> Decode<'r, DB> for Timestamp
where
    i64: Decode<'r, DB>,
{
    fn decode(value: DB::ValueRef<'r>) -> Result<Self, BoxDynError> {
        Ok(Self::from_millis(i64::decode(value)?)?)
    }
}

"""Fast JSON responses (orjson) that understand Decimal and dates."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

import orjson
from fastapi.responses import JSONResponse as _Base


def _default(obj: Any):
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (set, frozenset)):
        return list(obj)
    raise TypeError


def dumps(content: Any) -> bytes:
    # OPT_NAIVE_UTC: SQLite returns naive datetimes; they are stored as UTC, so label them as such.
    return orjson.dumps(content, default=_default, option=orjson.OPT_NON_STR_KEYS | orjson.OPT_NAIVE_UTC)


class JSONResponse(_Base):
    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return dumps(content)

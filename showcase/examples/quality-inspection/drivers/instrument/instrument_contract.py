"""Generated from the measuring-instrument driver contract 1.0.0. Do not edit;
regenerate with agent_native_driver.stubgen."""

from __future__ import annotations

import json
from typing import Any, Literal, NotRequired, TypedDict

DIGEST = '1c124a9d62922343de0c1e753746308b25a12b503f0383dc7407d6d4416f9213'
CONTRACT: dict[str, Any] = json.loads("{\"actions\":{},\"events\":{\"measurement.taken\":{\"kind\":\"occurrence\",\"maxRateHz\":10,\"payload\":{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"additionalProperties\":false,\"properties\":{\"unit\":{\"maxLength\":16,\"minLength\":1,\"type\":\"string\"},\"value\":{\"type\":\"number\"}},\"required\":[\"value\",\"unit\"],\"type\":\"object\"}}},\"id\":\"measuring-instrument\",\"lookup\":false,\"protocol\":\"1\",\"state\":{\"stable\":{\"type\":\"boolean\"},\"unit\":{\"type\":\"text\"},\"value\":{\"type\":\"number\"}},\"title\":\"Measuring instrument\",\"version\":\"1.0.0\"}")


class MeasurementTakenPayload(TypedDict):
    value: float
    unit: str

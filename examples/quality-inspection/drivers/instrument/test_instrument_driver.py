"""The line format and when a reading counts as a measurement, without a port or a host."""

from __future__ import annotations

import unittest

from instrument_driver import Instrument, Line, parse


class FakeDriver:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def emit(self, name: str, payload: dict) -> bool:
        self.events.append((name, payload))
        return True


class ParseTest(unittest.TestCase):
    def test_stable_unstable_and_overload_lines(self):
        self.assertEqual(parse("ST,+00012.031 mm\r\n"), Line(stable=True, value=12.031, unit="mm"))
        self.assertEqual(parse("US,-00000.004  g"), Line(stable=False, value=-0.004, unit="g"))
        self.assertEqual(parse("OL,+9999999E+19"), Line(stable=False, value=None, unit=None))
        self.assertEqual(parse("ST,+00012.031"), Line(stable=True, value=12.031, unit=None))

    def test_anything_else_is_not_a_reading(self):
        for text in ["", "hello", "XX,+1 mm", "ST", "ST;+1 mm"]:
            self.assertIsNone(parse(text), text)


class MeasurementTest(unittest.TestCase):
    def lines(self, output: str, texts: list[str]) -> list[float]:
        driver = FakeDriver()
        instrument = Instrument(driver, output)  # type: ignore[arg-type]
        for text in texts:
            instrument.take(text)
        return [payload["value"] for _, payload in driver.events]

    def test_key_output_sends_every_stable_line(self):
        texts = ["US,+1.0 mm", "ST,+1.2 mm", "ST,+1.2 mm", "OL,+9E+19", "ST,+1.3"]
        # The last line has no unit, so it is not a measurement.
        self.assertEqual(self.lines("key", texts), [1.2, 1.2])

    def test_stream_output_sends_once_each_time_the_reading_settles(self):
        texts = ["US,+1.0 mm", "ST,+1.2 mm", "ST,+1.2 mm", "US,+1.5 mm", "ST,+1.6 mm", "ST,+1.6 mm"]
        self.assertEqual(self.lines("stream", texts), [1.2, 1.6])


if __name__ == "__main__":
    unittest.main()

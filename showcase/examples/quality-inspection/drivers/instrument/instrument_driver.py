"""Driver for the capture station's gauge or balance, read over its serial data output.

The instrument sends one line per reading in the A&D-style format many balances and gauge
interfaces share: a two-letter header, a comma, a signed value and a unit, ending in CR LF.

    ST,+00012.031 mm     stable reading
    US,+00012.029 mm     unstable (still stabilizing)
    OL,+9999999E+19      overload: no value

`measurement.taken` is sent for a stable reading. In ``key`` output (the default) the instrument
sends a line only when the inspector presses its print or data button, so each stable line is a
measurement. In ``stream`` output it sends lines continuously, so a measurement is sent once
each time the reading stabilizes after moving.

Configuration comes from the environment the site policy binds for the ``instrument-driver``
process:

- ``INSTRUMENT_PORT`` (required): the serial device, such as ``/dev/ttyUSB0`` or ``COM3``.
- ``INSTRUMENT_BAUD`` (default 2400) and ``INSTRUMENT_FRAME`` (default ``7E1``: data bits,
  parity N/E/O, stop bits).
- ``INSTRUMENT_OUTPUT``: ``key`` (default) or ``stream``.
- ``INSTRUMENT_ID``: the instrument's asset or calibration number, reported as its serial so
  each result names the unit that measured it.

The driver has no actions: nothing the host sends can make the instrument do anything.
"""

from __future__ import annotations

import os
import re
import sys
import threading
from dataclasses import dataclass

import serial

from tortoise_driver import Device, Driver, Reading, Refusal
from instrument_contract import CONTRACT, DIGEST

try:
    from termios import error as TermiosError
except ImportError:  # Windows: pyserial does not use termios there.
    TermiosError = OSError

# pyserial lets termios.error, which is not an OSError, escape from configuring a port.
PORT_ERRORS = (serial.SerialException, OSError, TermiosError)

VERSION = "1.0.0"
HEADERS = ("ST", "US", "OL", "QT")
NUMBER = re.compile(r"([+-]?\d+(?:\.\d+)?)\s*(\S{1,16})?")


@dataclass(frozen=True)
class Line:
    stable: bool
    value: float | None
    unit: str | None


def parse(text: str) -> Line | None:
    """One instrument line, or None for anything that is not a reading."""
    header, comma, rest = text.strip().partition(",")
    if not comma or header not in HEADERS:
        return None
    match = NUMBER.fullmatch(rest.strip())
    if header == "OL" or match is None:
        return Line(stable=False, value=None, unit=None)
    return Line(stable=header == "ST", value=float(match[1]), unit=match[2])


class Instrument:
    """The open port, the last line it sent, and the thread that reads it."""

    def __init__(self, driver: Driver, output: str) -> None:
        self.driver = driver
        self.output = output
        self.port: serial.Serial | None = None
        self.last = Line(stable=False, value=None, unit=None)
        self.unit: str | None = None
        self.failure: str | None = None
        self.closed = threading.Event()

    def open(self, path: str, baud: int, frame: str) -> None:
        bits, parity, stop = frame[0], frame[1].upper(), frame[2]
        self.port = serial.Serial(
            path,
            baud,
            bytesize={"7": serial.SEVENBITS, "8": serial.EIGHTBITS}[bits],
            parity={"N": serial.PARITY_NONE, "E": serial.PARITY_EVEN, "O": serial.PARITY_ODD}[parity],
            stopbits={"1": serial.STOPBITS_ONE, "2": serial.STOPBITS_TWO}[stop],
            timeout=0.5,
        )
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        assert self.port is not None
        while not self.closed.is_set():
            try:
                raw = self.port.readline()
            except PORT_ERRORS as error:
                # A health check reports it; the host then restarts the driver.
                self.failure = f"The instrument port failed: {error}"
                return
            if raw:
                self.take(raw.decode("ascii", "replace"))

    def take(self, text: str) -> None:
        line = parse(text)
        if line is None:
            return
        stabilized = line.stable and (self.output == "key" or not self.last.stable)
        self.last = line
        if line.unit:
            self.unit = line.unit
        if stabilized and line.value is not None and line.unit:
            self.driver.emit("measurement.taken", {"value": line.value, "unit": line.unit})

    def close(self) -> None:
        self.closed.set()
        if self.port is not None:
            self.port.close()


def create(environ: dict[str, str] | None = None) -> Driver:
    environ = dict(os.environ) if environ is None else environ
    driver = Driver(CONTRACT, DIGEST, driver_id="ad-serial-instrument", version=VERSION)
    output = environ.get("INSTRUMENT_OUTPUT", "key")
    instrument = Instrument(driver, "stream" if output == "stream" else "key")

    @driver.on_initialize
    def open_port(configuration):
        path = environ.get("INSTRUMENT_PORT")
        if not path:
            raise Refusal("refused", "INSTRUMENT_PORT is not set for the instrument driver")
        if instrument.port is None:
            try:
                instrument.open(path, int(environ.get("INSTRUMENT_BAUD", "2400")), environ.get("INSTRUMENT_FRAME", "7E1"))
            except (*PORT_ERRORS, KeyError, IndexError, ValueError) as error:
                raise Refusal("transient", f"The instrument port could not be opened: {error}") from error
        return [Device(serial=environ.get("INSTRUMENT_ID") or None)]

    @driver.on_state
    def read(fields):
        return Reading(
            values={"stable": instrument.last.stable, "unit": instrument.unit, "value": instrument.last.value}
        )

    @driver.on_health
    def health():
        if instrument.failure:
            raise Refusal("transient", instrument.failure)

    @driver.on_shutdown
    def release():
        instrument.close()

    return driver


if __name__ == "__main__":
    sys.exit(create().run())

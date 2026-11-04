"""The SDK's own rules, without a host: gating, deduplication, the journal and stub generation."""

from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from tortoise_driver import ActionResult, Device, Driver, Refusal, contract_digest
from tortoise_driver.stubgen import generate

CONTRACT = {
    "protocol": "1",
    "id": "press",
    "version": "1.0.0",
    "title": "Press",
    "state": {"force": {"type": "number"}, "door": {"type": "enum", "options": ["open", "closed"]}},
    "actions": {
        "stamp": {"title": "Stamp", "delivery": "once", "risk": "operator-present", "timeoutMs": 1000,
                  "input": {"type": "object", "properties": {"part": {"type": "string"},
                            "presence": {"type": "object", "properties": {"confirmedBy": {"type": "string"}},
                                         "required": ["confirmedBy"]}}, "required": ["part"]}},
        "label": {"title": "Label", "delivery": "idempotent", "risk": "none", "timeoutMs": 1000,
                  "input": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
        "force.set": {"title": "Set force", "delivery": "convergent", "risk": "low", "timeoutMs": 1000,
                      "input": {"type": "object", "properties": {"force": {"type": "number"}}, "required": ["force"]},
                      "readback": [{"field": "force", "equals": "$input.force"}]},
    },
    "events": {"reading": {"kind": "telemetry", "maxRateHz": 1}},
    "lookup": True,
}
CONFIRMED = {"confirmedBy": "ina"}


def run(coroutine):
    return asyncio.run(coroutine)


class PressTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.journal = str(Path(self.directory.name) / "journal.jsonl")
        self.applied: list[str] = []
        self.driver = self.make()

    def tearDown(self) -> None:
        self.driver.journal.close()
        self.directory.cleanup()

    def make(self) -> Driver:
        driver = Driver(CONTRACT, contract_digest(CONTRACT), driver_id="press", version="1", journal=self.journal)

        @driver.on_initialize
        def open_press(configuration):
            return [Device(serial="P-1")]

        @driver.on_state
        def read(fields):
            return {"force": 3.5, "door": "closed", "noise": 1}

        @driver.action("stamp")
        def stamp(input, context):
            if input["part"] == "bad":
                raise Refusal("rejected", "No such part", "PART")
            if input["part"] == "crash":
                raise RuntimeError("servo fault")
            self.applied.append(context.effect_id)
            return ActionResult(ref=f"stamp-{len(self.applied)}")

        @driver.action("label")
        async def label(input, context):
            if input["text"] == "busy":
                raise Refusal("transient", "Printer busy")
            self.applied.append(context.effect_id)

        @driver.action("force.set")
        def set_force(input, context):
            self.applied.append(context.effect_id)

        run(driver.handle("initialize", {"protocol": "1", "contract": {"id": "press"}, "mode": "monitor-only"}))
        return driver

    def invoke(self, action, input, effect_id="e1", mode="actuate", driver=None):
        params = {"action": action, "input": input, "effectId": effect_id, "mode": mode}
        return run((driver or self.driver).handle("action.invoke", params))

    def refusal(self, *args, **kwargs) -> Refusal:
        with self.assertRaises(Refusal) as caught:
            self.invoke(*args, **kwargs)
        return caught.exception

    def test_handshake_reports_units_and_refuses_another_contract(self):
        result = run(self.driver.handle("initialize", {"protocol": "1", "contract": {"id": "press"}}))
        self.assertEqual(result["devices"], [{"serial": "P-1"}])
        self.assertEqual(result["contract"], {"digest": contract_digest(CONTRACT)})
        with self.assertRaises(Refusal):
            run(self.driver.handle("initialize", {"protocol": "1", "contract": {"id": "oven"}}))

    def test_state_returns_only_declared_fields_that_were_asked(self):
        result = run(self.driver.handle("state.read", {"fields": ["force", "noise"]}))
        self.assertEqual(result["values"], {"force": 3.5})

    def test_mode_and_presence_are_enforced_before_the_handler(self):
        self.assertEqual(self.refusal("label", {"text": "x"}, mode="monitor-only").kind, "refused")
        self.assertEqual(self.refusal("force.set", {"force": 1}, mode="assist").kind, "refused")
        self.assertEqual(self.refusal("stamp", {"part": "a"}).kind, "precondition")
        self.invoke("label", {"text": "x"}, mode="assist")
        self.assertEqual(self.applied, ["e1"])

    def test_a_passed_deadline_refuses_without_acting(self):
        params = {"action": "label", "input": {"text": "x"}, "effectId": "e1", "mode": "actuate", "deadline": 1}
        with self.assertRaises(Refusal) as caught:
            run(self.driver.handle("action.invoke", params))
        self.assertEqual(caught.exception.kind, "transient")
        self.assertEqual(self.applied, [])

    def test_once_and_idempotent_actions_run_once_per_effect_and_survive_a_restart(self):
        first = self.invoke("stamp", {"part": "a", "presence": CONFIRMED}, "s1")
        self.assertEqual(self.invoke("stamp", {"part": "a", "presence": CONFIRMED}, "s1"), first)
        self.invoke("label", {"text": "x"}, "l1")
        self.invoke("label", {"text": "x"}, "l1")
        self.driver.journal.close()
        restarted = self.make()
        self.assertEqual(run(restarted.handle("action.lookup", {"effectId": "s1"})), {"status": "accepted", "ref": "stamp-1"})
        self.invoke("label", {"text": "x"}, "l1", driver=restarted)
        self.assertEqual(self.applied, ["s1", "l1"])
        restarted.journal.close()

    def test_convergent_actions_are_not_deduplicated(self):
        self.invoke("force.set", {"force": 1}, "f1")
        self.invoke("force.set", {"force": 1}, "f1")
        self.assertEqual(self.applied, ["f1", "f1"])

    def test_rejections_are_recorded_and_a_transient_failure_can_run_again(self):
        self.assertEqual(self.refusal("stamp", {"part": "bad", "presence": CONFIRMED}, "s1").code, "PART")
        self.assertEqual(
            run(self.driver.handle("action.lookup", {"effectId": "s1"})),
            {"status": "rejected", "code": "PART", "message": "No such part"},
        )
        self.assertEqual(self.refusal("label", {"text": "busy"}, "l1").kind, "transient")
        self.assertEqual(run(self.driver.handle("action.lookup", {"effectId": "l1"})), {"status": "unknown"})
        self.invoke("label", {"text": "ok"}, "l1")
        self.assertEqual(self.applied, ["l1"])

    def test_an_action_that_fails_while_acting_is_uncertain_and_never_repeated(self):
        self.assertEqual(self.refusal("stamp", {"part": "crash", "presence": CONFIRMED}, "s1").kind, "uncertain")
        self.assertEqual(run(self.driver.handle("action.lookup", {"effectId": "s1"}))["status"], "uncertain")
        self.assertEqual(self.refusal("stamp", {"part": "a", "presence": CONFIRMED}, "s1").kind, "uncertain")
        self.assertEqual(self.refusal("label", {"text": "x"}, "s1").code, "EFFECT_REUSED")

    def test_once_actions_need_a_journal(self):
        with self.assertRaises(ValueError):
            Driver(CONTRACT, "0" * 64, driver_id="press", version="1")


class ServeTest(unittest.TestCase):
    def test_messages_over_pipes_events_and_shutdown(self):
        import os

        driver = Driver({**CONTRACT, "actions": {}}, "d" * 64, driver_id="press", version="1")
        host_to_driver_read, host_to_driver_write = os.pipe()
        driver_to_host_read, driver_to_host_write = os.pipe()

        @driver.on_state
        def read(fields):
            driver.emit("reading", {"force": 1})
            driver.emit("reading", {"force": 2})  # dropped: above maxRateHz
            return {"force": 1}

        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "state.read", "params": {"fields": ["force"]}},
            {"jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {"protocol": "1", "contract": {"id": "press"}}},
            {"jsonrpc": "2.0", "id": 3, "method": "state.read", "params": {"fields": ["force"]}},
            {"jsonrpc": "2.0", "id": 4, "method": "nope", "params": {}},
            {"jsonrpc": "2.0", "id": 5, "method": "shutdown", "params": {}},
        ]
        with os.fdopen(host_to_driver_write, "wb") as writer:
            writer.write(b"not json\n" + b"".join(json.dumps(r).encode() + b"\n" for r in requests))
        with os.fdopen(host_to_driver_read, "rb") as input, os.fdopen(driver_to_host_write, "wb") as output:
            asyncio.run(driver.serve(input, output))
        with os.fdopen(driver_to_host_read, "rb") as output:
            messages = [json.loads(line) for line in output.read().splitlines()]
        by_id = {message.get("id"): message for message in messages}
        self.assertEqual(by_id[1]["error"]["data"]["kind"], "transient")
        self.assertEqual(by_id[3]["result"]["values"], {"force": 1})
        self.assertEqual(by_id[4]["error"]["code"], -32601)
        self.assertEqual(by_id[5]["result"], {})
        events = [message["params"] for message in messages if message.get("method") == "event"]
        self.assertEqual([(event["seq"], event["payload"]) for event in events], [(0, {"force": 1})])


class LineReaderTest(unittest.TestCase):
    def test_an_oversized_line_is_dropped_and_a_last_line_needs_no_newline(self):
        import os
        import threading

        from tortoise_driver.rpc import MAX_LINE, LineReader

        read, write = os.pipe()

        def send():
            # More than a pipe buffer holds, so it is written while the reader reads.
            with os.fdopen(write, "wb") as writer:
                writer.write(b"one\n" + b"x" * (MAX_LINE + 10) + b"\ntwo\nthree")

        threading.Thread(target=send, daemon=True).start()

        async def lines():
            with os.fdopen(read, "rb") as stream:
                reader = LineReader(stream, asyncio.get_running_loop())
                found = []
                while (line := await reader.next()) is not None:
                    found.append(line)
                return found

        self.assertEqual(run(lines()), [b"one\n", b"two\n", b"three"])


class StubTest(unittest.TestCase):
    def test_stub_holds_digest_contract_and_typed_inputs(self):
        text = generate({"digest": contract_digest(CONTRACT), "document": CONTRACT})
        namespace: dict = {}
        exec(compile(text, "press_contract.py", "exec"), namespace)
        self.assertEqual(namespace["DIGEST"], contract_digest(CONTRACT))
        self.assertEqual(namespace["CONTRACT"], CONTRACT)
        self.assertIn("class StampInput(TypedDict):", text)
        self.assertIn("    presence: NotRequired[StampInputPresence]", text)
        self.assertIn("ForceSetInput", text)

    def test_digest_matches_the_host_canonical_form(self):
        # The host's digest of this document, from `driver contract` on the TypeScript side.
        document = {"b": [1, 2.5, "°C"], "a": {"z": None, "y": True}}
        self.assertEqual(
            contract_digest(document),
            __import__("hashlib").sha256('{"a":{"y":true,"z":null},"b":[1,2.5,"°C"]}'.encode()).hexdigest(),
        )

    def test_an_edited_document_is_refused(self):
        with self.assertRaises(ValueError):
            generate({"digest": contract_digest(CONTRACT), "document": {**CONTRACT, "version": "2"}})


if __name__ == "__main__":
    unittest.main()

"""Generate a Python module from a driver contract document.

The host application writes the document with ``app driver contract <id> --out contract.json``:
``{"digest": ..., "document": ...}``. This module recomputes the digest from the document the way
the host does (canonical JSON, SHA-256) and refuses a file whose digest does not match, so a
hand-edited contract never reaches a driver. The generated module holds ``DIGEST``, ``CONTRACT``
and one ``TypedDict`` per action input, result and event payload.

    python -m tortoise_driver.stubgen contract.json -o chamber_contract.py
"""

from __future__ import annotations

import argparse
import json
import keyword
import re
import sys
from pathlib import Path
from typing import Any

from .digest import canonical_json, contract_digest


def _class_name(*parts: str) -> str:
    words = [word for part in parts for word in re.split(r"[^A-Za-z0-9]+", part) if word]
    return "".join(word[:1].upper() + word[1:] for word in words)


class _Types:
    """JSON Schema to Python annotations, collecting TypedDicts for objects."""

    def __init__(self) -> None:
        self.classes: list[str] = []

    def annotation(self, schema: Any, name: str) -> str:
        if not isinstance(schema, dict):
            return "Any"
        if "enum" in schema:
            return f"Literal[{', '.join(repr(value) for value in schema['enum'])}]"
        if "const" in schema:
            return f"Literal[{schema['const']!r}]"
        for key in ("anyOf", "oneOf"):
            if key in schema:
                options = [self.annotation(option, f"{name}{index}") for index, option in enumerate(schema[key])]
                return " | ".join(dict.fromkeys(options))
        kind = schema.get("type")
        if isinstance(kind, list):
            return " | ".join(self.annotation({**schema, "type": item}, name) for item in kind)
        if kind == "string":
            return "str"
        if kind == "integer":
            return "int"
        if kind == "number":
            return "float"
        if kind == "boolean":
            return "bool"
        if kind == "null":
            return "None"
        if kind == "array":
            return f"list[{self.annotation(schema.get('items'), name + 'Item')}]"
        if kind == "object" and "properties" in schema:
            return self.typed_dict(schema, name)
        if kind == "object":
            return "dict[str, Any]"
        return "Any"

    def typed_dict(self, schema: dict, name: str) -> str:
        required = set(schema.get("required", []))
        lines = []
        for prop, sub in schema["properties"].items():
            annotation = self.annotation(sub, name + _class_name(prop))
            if prop not in required:
                annotation = f"NotRequired[{annotation}]"
            lines.append((prop, annotation))
        if all(prop.isidentifier() and not keyword.iskeyword(prop) for prop, _ in lines):
            body = "\n".join(f"    {prop}: {annotation}" for prop, annotation in lines) or "    pass"
            self.classes.append(f"class {name}(TypedDict):\n{body}\n")
        else:
            fields = ", ".join(f"{prop!r}: {annotation}" for prop, annotation in lines)
            self.classes.append(f"{name} = TypedDict({name!r}, {{{fields}}})\n")
        return name


def generate(contract_file: dict) -> str:
    """The module text for a contract file. Raises ValueError when its digest does not match."""
    document = contract_file["document"]
    digest = contract_digest(document)
    if digest != contract_file.get("digest"):
        raise ValueError("The contract file's digest does not match its document; regenerate it")
    types = _Types()
    for name, action in document.get("actions", {}).items():
        types.annotation(action.get("input"), _class_name(name, "input"))
        if "result" in action:
            types.annotation(action["result"], _class_name(name, "result"))
    for name, event in document.get("events", {}).items():
        if "payload" in event:
            types.annotation(event["payload"], _class_name(name, "payload"))
    literal = json.dumps(canonical_json(document), ensure_ascii=False)
    return "\n".join(
        [
            f'"""Generated from the {document["id"]} driver contract {document["version"]}. Do not edit;',
            'regenerate with tortoise_driver.stubgen."""',
            "",
            "from __future__ import annotations",
            "",
            "import json",
            "from typing import Any, Literal, NotRequired, TypedDict",
            "",
            f"DIGEST = {digest!r}",
            f"CONTRACT: dict[str, Any] = json.loads({literal})",
            "",
            "",
            "\n\n".join(types.classes),
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("contract", help="contract file written by `driver contract`")
    parser.add_argument("-o", "--out", help="output module; stdout when omitted")
    args = parser.parse_args(argv)
    try:
        text = generate(json.loads(Path(args.contract).read_text(encoding="utf-8")))
    except (ValueError, KeyError) as error:
        print(f"stubgen: {error}", file=sys.stderr)
        return 1
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

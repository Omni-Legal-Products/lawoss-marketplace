#!/usr/bin/env python3
"""Project canonical Codex entries into the separately validated Claude schema."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
codex = json.loads((root / '.agents/plugins/marketplace.json').read_text())
path = root / '.claude-plugin/marketplace.json'
claude = json.loads(path.read_text())
claude['plugins'] = []
for entry in codex['plugins']:
    manifest = json.loads((root / entry['source']['path'] / '.codex-plugin/plugin.json').read_text())
    plugin_path = root / entry['source']['path'] / '.claude-plugin/plugin.json'
    if plugin_path.exists():
        plugin = json.loads(plugin_path.read_text())
        plugin.update(version=manifest['version'], description=manifest['description'])
        plugin_path.write_text(json.dumps(plugin, indent=2, ensure_ascii=False) + '\n')
    claude['plugins'].append(dict(name=entry['name'], source=entry['source']['path'],
                                  description=manifest['description'], version=manifest['version'], category=entry['category']))
path.write_text(json.dumps(claude, indent=2, ensure_ascii=False) + '\n')

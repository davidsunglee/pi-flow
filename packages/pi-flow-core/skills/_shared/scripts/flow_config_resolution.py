#!/usr/bin/env python3
"""flow_config_resolution — shared project-aware flow.json resolution.

See skills/_shared/flow-config-resolution.md for the normative contract.
Imported as a sibling module by the _shared dispatch/provenance helpers and the
public resolve-flow-config CLI. Selection is on existence + readability only;
JSON is never parsed here.
"""
import os

USER_GLOBAL_FLOW_CONFIG = "~/.pi/agent/flow.json"


class FlowConfigError(Exception):
    """Raised when no usable flow config can be resolved.

    `searched` holds the absolute paths consulted, in resolution order.
    """

    def __init__(self, searched):
        super().__init__("flow.json missing or unreadable")
        self.searched = list(searched)


def _abspath(path):
    return os.path.abspath(os.path.expanduser(path))


def _readable(path):
    try:
        with open(path):
            return True
    except OSError:
        return False


def resolve_flow_config(working_dir=None, flow_config_override=None):
    """Resolve the active flow config.

    Returns (path, scope, searched) where scope is "explicit" | "project" |
    "user", path is the absolute selected path, and searched is the list of
    absolute paths consulted in resolution order. Raises FlowConfigError(searched)
    when nothing usable is found (or an explicit override is unreadable).
    """
    searched = []
    if flow_config_override:
        path = _abspath(flow_config_override)
        searched.append(path)
        if _readable(path):
            return path, "explicit", searched
        raise FlowConfigError(searched)

    base = working_dir if working_dir else os.getcwd()
    project = _abspath(os.path.join(base, ".pi", "flow.json"))
    searched.append(project)
    if _readable(project):
        return project, "project", searched

    user = _abspath(USER_GLOBAL_FLOW_CONFIG)
    searched.append(user)
    if _readable(user):
        return user, "user", searched

    raise FlowConfigError(searched)


def render_locations(searched, home=None):
    """Render searched paths comma-space separated, home prefix abbreviated to ~."""
    if home is None:
        home = os.path.expanduser("~")
    rendered = []
    for path in searched:
        if home and (path == home or path.startswith(home + os.sep)):
            rendered.append("~" + path[len(home):])
        else:
            rendered.append(path)
    return ", ".join(rendered)


def missing_config_clause(searched, home=None):
    """The shared canonical clause (no per-consumer suffix)."""
    return f"flow.json missing or unreadable; searched {render_locations(searched, home)}"

---
name: codebook
description: Use Codebook's observed source and runtime evidence to explain a web app through the current editor workspace.
metadata:
  version: "1.0.1"
---

# Codebook

Use this skill for the user's request in the current editor workspace. Begin with `codebook_status` to confirm the workspace, instance, available capabilities and prerequisites. If the Codebook tools are missing or the connection is unavailable, say what is missing and direct the user to **Codebook: Set Up AI Chat** in this editor. Do not claim an observed result from a generic source explanation.

Follow the public Codebook help/resources and the returned current state to select only the tools needed for the request. When relevant, inspect source, operate the application, pause execution, read actual values, explain the relationship, continue from the **current** run state using its returned arguments, and save or replay a recording. Do not invent stop locations, values or repository-specific steps.

Separate directly observed facts, source-based inferences and unverified points in the answer. Use connection identifiers only in tool arguments; do not repeat credentials, endpoints or temporary instance IDs in chat prose. If a prerequisite or capability is unavailable, explain the limit and the next normal setup step. The learner alone decides whether an understanding check is complete; never mark one on their behalf.

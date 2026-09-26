# Cycle 0028 — Cursor 0.2.11 setup preflight

Date: 2026-09-26. Development preflight only; **no ordinary-chat outcome and no D029 Stage 1/2 credit**.

The checked 0.2.11 VSIX (SHA-256 `2ca23ab41d26c242769f1a62a129ac4af5184666ab6a3b553c1d4505682c6c95`) installed in a dedicated Cursor extension directory. A new isolated user-data profile opened, but Cursor Agent required sign-in. The exact question was not sent there.

Cursor forwarded a subsequent work window using the owner's signed-in profile to the owner's existing process, which also hosted active unrelated work. The extension was temporarily installed in that shared profile. In a dedicated `cb211-cursor` window, the public `Codebook: Set Up AI Chat` command succeeded. Cursor Customize showed one `codebook` skill and the Codebook MCP connector connected with 15 tools and four resources; the deployed skill matched bundled 1.0.20. This establishes discovery and connection only. While preparing the Agent input, the active window switched to the owner's unrelated work. No Codebook question was sent; no AI-owned result, Study entry, recording, or native motion was observed.

The owner's shared profile was restored after the preflight: the original skill SHA-256 `4ba173b890b94bbc31cb7e603925c8a5ab79cdb9c991fc02e45d6a692d4d7d0f` and inode `272512068`, original receipt SHA-256 `27f4936e0710f1cc6ac96faa21c8e7a1a9078737e86c2cfb5d271a09a0207799`, original Codebook extension registry entry, and unchanged MCP config SHA-256 `70f76bb304f862fb1fc26f69fc9ee43134107b2d41797994a74ddd0853e0de4d`. Other registry entries were retained. The trial extension and newer skill were moved to ignored private storage for recovery. The owner's unrelated work was not edited.

Next: run the exact question in a dedicated signed-in Cursor process/window that can be kept separate from active owner work, record the native interaction, inspect pause frames, and verify Study plus recording. This preflight cannot be reported as Cursor product validation.

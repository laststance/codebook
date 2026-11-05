import type { ServerReplayModel } from './buildServerReplayModel'
import { NODE_SCRIPT_REPLAY_TEXT } from './describeNodeScriptReplay'
import { NODE_SERVER_REPLAY_TEXT } from './describeNodeServerReplay'

/**
 * Names which node run a replay model presents, from its header: the one switch every server-shaped projection reads so a script replay is worded with the script catalog and a server replay never changes.
 * Called by {@link projectServerApplication}, {@link projectServerSection}, {@link projectServerReplayViews} and the Study workspace.
 * @param model - The replay model, or anything that carries its header.
 * @returns `node-script` for a script replay, `node-server` otherwise.
 * @example nodeRunProfileOf(model) // => 'node-server'
 */
export function nodeRunProfileOf(
  model: Pick<ServerReplayModel, 'header'>,
): 'node-server' | 'node-script' {
  return model.header.profile
}

/**
 * Gives the fixed words of the replay a model presents.
 * @param model - The replay model, or anything that carries its header.
 * @returns The script catalog for a script replay, the server catalog otherwise.
 * @example nodeRunReplayWords(model).heading // => 'Server replay'
 */
export function nodeRunReplayWords(
  model: Pick<ServerReplayModel, 'header'>,
): typeof NODE_SERVER_REPLAY_TEXT | typeof NODE_SCRIPT_REPLAY_TEXT {
  return model.header.profile === 'node-script'
    ? NODE_SCRIPT_REPLAY_TEXT
    : NODE_SERVER_REPLAY_TEXT
}

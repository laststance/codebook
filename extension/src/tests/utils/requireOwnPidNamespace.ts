import { LINUX_PID_NAMESPACE_PATH, PROCESS_START_FORMS } from '../../constants'
import {
  processStartFormHere,
  type ProcessStartFormInputs,
} from '../../utils/processStartFormHere'

/**
 * Ends a test that needs this test process to name its own pid namespace, with one sentence that names the link that could not be read: a test that takes the real identity of this process and expects a marker or a claim of a project folder to be judged by its process would otherwise fail later, on an assertion that says nothing about the namespace.
 * A Linux window that cannot read its pid namespace judges no record of a project folder by its process ({@link canJudgeOwnerHere}), so such a test cannot hold there. macOS and Windows have one space of process ids each and need no namespace. The tests call it first, before they arrange anything; a test that does not need the real window names a fixed one instead.
 * @param inputs - What the form of this process's starts is read with; the real system unless a test of this utility names its own.
 * @throws "This test process could not read its own pid namespace (the link /proc/self/ns/pid): …" on Linux when the link cannot be read or names no pid namespace.
 * @example
 * requireOwnPidNamespace() // returns on macOS, on Windows and on a Linux system that names its pid namespace
 */
export function requireOwnPidNamespace(
  inputs: ProcessStartFormInputs = {},
): void {
  // Only the Linux form without a namespace names no space of process ids.
  if (processStartFormHere(inputs) !== PROCESS_START_FORMS.linux) return
  throw new Error(
    `This test process could not read its own pid namespace (the link ${LINUX_PID_NAMESPACE_PATH}): a Linux window that names no pid namespace judges no record of a project folder by its process, which this test needs.`,
  )
}

/**
 * Lets one Save run at a time for a node run's learning replay: a Save of the same study while one runs joins it, and a Save of another study is refused.
 * Held by the Save of a test run and the Save of a server run, which differ only in the work each does.
 * @example
 * const saves = new SaveSerializer()
 * await saves.run(studyId, () => saveOnce(record), () => host.changed())
 */
export class SaveSerializer {
  private current?: { studyId: string; promise: Promise<void> }

  /**
   * Starts the Save of a run's study, or joins the one in flight for it.
   * @param service - Names the instance the study id is made of.
   * @param record - The run being saved.
   * @param work - Does the Save for the study id.
   * @param settled - Told once the work ended, so the status item is drawn again.
   * @returns The promise of the Save in flight.
   * @throws When another study is being saved.
   */
  runFor(
    service: { instanceId: string },
    record: { id: string },
    work: (studyId: string) => Promise<void>,
    settled: () => void,
  ): Promise<void> {
    const studyId = `${service.instanceId}_${record.id}`
    return this.run(studyId, () => work(studyId), settled)
  }

  /**
   * Starts the Save of a study, or joins the one in flight for it.
   * @param studyId - The study this Save names.
   * @param work - Does the Save.
   * @param settled - Told once the work ended.
   * @returns The promise of the Save in flight.
   * @throws When another study is being saved.
   */
  private run(
    studyId: string,
    work: () => Promise<void>,
    settled: () => void,
  ): Promise<void> {
    if (this.current) {
      if (this.current.studyId !== studyId)
        throw new Error(
          'Another learning session is being saved. Wait for its result.',
        )
      return this.current.promise
    }
    const promise = work().finally(() => {
      if (this.current?.promise === promise) this.current = undefined
      settled()
    })
    this.current = { studyId, promise }
    return promise
  }
}

export const state = { batchCalls: 0, disposed: false, modelPath: '' }

export async function createSession(paths) {
  state.modelPath = paths.modelPath
  return {
    async embedBatch(input) {
      state.batchCalls++
      const { batchSize, sequenceLength } = input
      const data = new Float32Array(batchSize * sequenceLength * 2)
      for (let index = 0; index < data.length; index += 2) { data[index] = 1; data[index + 1] = 2 }
      return { dims: [batchSize, sequenceLength, 2], data }
    },
    async dispose() { state.disposed = true },
  }
}

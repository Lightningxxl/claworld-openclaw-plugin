let currentRuntime = null;

export function setClaworldRuntime(runtime) {
  currentRuntime = runtime || null;
}

export function getClaworldRuntime() {
  if (!currentRuntime) {
    throw new Error('Claworld runtime not initialized');
  }
  return currentRuntime;
}

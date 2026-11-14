// 固定步长累加器：把不规律的 rAF 间隔切成等长的逻辑步。
// 渲染帧率只影响「一帧里跑几步」，不影响每步的时长。
export function createFixedStepDriver(fixedStep, maxDelta, onStep) {
  if (!(fixedStep > 0)) throw new Error('fixedStep 必须为正');
  let acc = 0;
  const guard = Math.ceil(maxDelta / fixedStep) + 8;
  return {
    advance(realDelta) {
      acc += Math.min(Math.max(0, realDelta), maxDelta);
      let n = 0;
      while (acc >= fixedStep && n < guard) {
        acc -= fixedStep;
        onStep(fixedStep);
        n++;
      }
      return n;
    },
    reset() { acc = 0; },
  };
}

import { type SceneFactory, seededRandom } from "../../scene";

const DROP_PERIOD = 3.2;
const DROP_LIFE = 6.4;
const MIST_BANDS = 3;

/** 水墨：雾带缓移，墨滴落下后晕开、淡去；偶有一滴朱砂。 */
export const inkScene: SceneFactory = (seed) => {
  const drop = (index: number) => {
    const random = seededRandom(seed * 7919 + index * 104729);
    return {
      x: 0.08 + 0.84 * random(),
      y: 0.1 + 0.7 * random(),
      size: 0.04 + 0.06 * random(),
      seal: random() < 0.16,
    };
  };
  return {
    draw({ context, width, height, time, dark }) {
      const ink = dark ? "230 232 228" : "31 27 22";
      for (let band = 0; band < MIST_BANDS; band += 1) {
        const x = width * (0.5 + 0.35 * Math.sin(time * 0.03 + band * 2.1));
        const y = height * (0.55 + 0.12 * band);
        const radius = width * 0.45;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgb(${ink} / ${dark ? 0.035 : 0.045})`);
        gradient.addColorStop(1, `rgb(${ink} / 0)`);
        context.save();
        context.translate(0, y);
        context.scale(1, 0.18);
        context.translate(0, -y);
        context.fillStyle = gradient;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        context.restore();
      }
      const current = Math.floor(time / DROP_PERIOD);
      for (let index = current - 1; index <= current; index += 1) {
        const age = time - index * DROP_PERIOD;
        if (index < 0 || age < 0 || age > DROP_LIFE) continue;
        const progress = age / DROP_LIFE;
        const { x, y, size, seal } = drop(index);
        const color = seal ? "200 55 45" : ink;
        const fade = (1 - progress) ** 1.5 * Math.min(1, age / 0.4);
        const alpha = (dark ? 0.07 : 0.09) * fade;
        const spread = 0.15 + 0.85 * (1 - (1 - progress) ** 3);
        const radius = Math.min(width, height) * size * spread;
        const cx = x * width;
        const cy = y * height;
        const wash = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
        wash.addColorStop(0, `rgb(${color} / ${alpha})`);
        wash.addColorStop(0.62, `rgb(${color} / ${alpha * 0.8})`);
        wash.addColorStop(1, `rgb(${color} / 0)`);
        context.fillStyle = wash;
        context.beginPath();
        context.arc(cx, cy, radius, 0, Math.PI * 2);
        context.fill();
      }
    },
  };
};

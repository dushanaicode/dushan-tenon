import { type SceneFactory, seededRandom } from "../../scene";

const STARS = 42;
const BEAMS = 4;
const SCAN_PERIOD = 7;

/** 赛博：星点闪烁，霓虹光束斜穿画面，扫描带自上而下。 */
export const cyberScene: SceneFactory = (seed) => {
  const random = seededRandom(seed);
  const stars = Array.from({ length: STARS }, () => ({
    x: random(),
    y: random() * 0.62,
    size: 0.6 + random() * 1.4,
    speed: 0.6 + random() * 1.6,
    phase: random() * Math.PI * 2,
  }));
  const beams = Array.from({ length: BEAMS }, (_, index) => ({
    lane: 0.12 + 0.76 * random(),
    duration: 9 + random() * 5,
    offset: random(),
    magenta: index % 2 === 1,
  }));
  return {
    draw({ context, width, height, time, dark }) {
      const cyan = dark ? "62 230 255" : "0 153 187";
      const magenta = dark ? "255 95 210" : "206 67 158";
      for (const star of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(time * star.speed + star.phase);
        context.fillStyle = `rgb(${dark ? "239 250 255" : cyan} / ${(dark ? 0.55 : 0.3) * twinkle})`;
        context.beginPath();
        context.arc(
          star.x * width,
          star.y * height,
          star.size * (width / 1600 + 0.5),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
      const length = width * 0.18;
      const angle = -0.42;
      const dx = Math.cos(angle) * length;
      const dy = Math.sin(angle) * length;
      context.lineCap = "round";
      context.lineWidth = Math.max(1.5, width / 900);
      for (const beam of beams) {
        const progress = (time / beam.duration + beam.offset) % 1;
        const x = -length + (width + length * 2) * progress;
        const y = beam.lane * height + (progress - 0.5) * height * 0.3;
        const color = beam.magenta ? magenta : cyan;
        const glow = Math.sin(progress * Math.PI);
        const gradient = context.createLinearGradient(x, y, x + dx, y + dy);
        gradient.addColorStop(0, `rgb(${color} / 0)`);
        gradient.addColorStop(
          1,
          `rgb(${color} / ${(dark ? 0.75 : 0.5) * glow})`,
        );
        context.strokeStyle = gradient;
        context.shadowColor = `rgb(${color} / ${dark ? 0.8 : 0.4})`;
        context.shadowBlur = 12;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + dx, y + dy);
        context.stroke();
      }
      context.shadowBlur = 0;
      const scan = ((time % SCAN_PERIOD) / SCAN_PERIOD) * (height + 240) - 120;
      const band = context.createLinearGradient(0, scan - 120, 0, scan + 120);
      band.addColorStop(0, `rgb(${cyan} / 0)`);
      band.addColorStop(0.5, `rgb(${cyan} / ${dark ? 0.05 : 0.035})`);
      band.addColorStop(1, `rgb(${cyan} / 0)`);
      context.fillStyle = band;
      context.fillRect(0, scan - 120, width, 240);
    },
  };
};

const STORAGE_KEY = "music-visualizer-settings-v1";

const defaults = {
  mode: "auto",
  enabledModes: ["fluid", "ribbons", "bloom", "aurora", "orbit"],
  lockMode: false,
  transition: "hybrid",
  quality: "smooth",
  intensity: 1.1
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function averageRange(array, startIndex, endIndex) {
  let sum = 0;
  let count = 0;
  const last = Math.min(array.length - 1, endIndex);
  for (let i = Math.max(0, startIndex); i <= last; i += 1) {
    sum += array[i];
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

function showToast(message, type = "success") {
  const container = document.getElementById("toasts");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  window.setTimeout(() => toast.remove(), type === "error" ? 5000 : 3000);
}

function readSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...defaults };
    }
    return { ...defaults, ...JSON.parse(raw) };
  } catch (error) {
    return { ...defaults };
  }
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    // Storage can be unavailable in privacy modes; visualizer settings remain usable in memory.
  }
}

class VisualizerApp {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.settings = { ...settings };

    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.stream = null;

    this.frequencyData = new Uint8Array(1024);
    this.previousFrequencyData = new Uint8Array(1024);
    this.timeDomainData = new Uint8Array(1024);

    this.audioMetrics = {
      bass: 0,
      mid: 0,
      treble: 0,
      flux: 0,
      pulse: 0,
      energy: 0,
      onset: 0,
      beat: 0
    };
    this.smoothedAudio = { ...this.audioMetrics };

    this.modeOrder = ["fluid", "ribbons", "bloom", "aurora", "orbit", "prism", "lissajous", "constellation", "tidal", "helix"];
    this.modeNames = {
      fluid: "Fluid Tunnel",
      ribbons: "Harmonic Ribbons",
      bloom: "Radial Bloom",
      aurora: "Aurora Field",
      orbit: "Orbital Rings",
      prism: "Prism Lines",
      lissajous: "Lissajous Field",
      constellation: "Constellation",
      tidal: "Tidal Bands",
      helix: "Spiral Helix"
    };
    const savedEnabledModes = Array.isArray(settings.enabledModes)
      ? settings.enabledModes.filter((mode) => this.modeOrder.includes(mode))
      : [...this.modeOrder];
    this.enabledModes = savedEnabledModes;
    this.activeMode = "fluid";
    this.nextMode = null;
    this.transitionProgress = 0;
    this.transitionDuration = 3.2;
    this.modeTimer = 0;
    this.nextAutoSwitchAt = randomBetween(32, 48);

    this.seed = Math.random() * 1000;
    this.lastPulseTime = 0;
    this.bassHistory = [];
    this.beatEnvelope = 0;
    this.paletteIndex = 0;
    this.paletteTimer = 0;
    this.paletteDuration = randomBetween(28, 42);
    this.palettes = [
      { name: "Blue Violet", start: 205, spread: 95 },
      { name: "Aurora", start: 145, spread: 125 },
      { name: "Copper Rose", start: 18, spread: 70 },
      { name: "Glacial", start: 175, spread: 65 },
      { name: "Solar", start: 330, spread: 110 }
    ];

    this.lastTimestamp = performance.now();
    this.animationFrameId = 0;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(window.innerWidth * dpr);
    const height = Math.floor(window.innerHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  applyQualitySettings() {
    const isRich = this.settings.quality === "rich";
    if (this.analyser) {
      this.analyser.fftSize = isRich ? 4096 : 2048;
      this.analyser.smoothingTimeConstant = isRich ? 0.78 : 0.84;
      const bins = this.analyser.frequencyBinCount;
      this.frequencyData = new Uint8Array(bins);
      this.previousFrequencyData = new Uint8Array(bins);
      this.timeDomainData = new Uint8Array(bins);
    }
  }

  async attachStream(stream) {
    this.detachAudio();
    this.stream = stream;

    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    if (this.audioContext.state !== "running") {
      await this.audioContext.resume();
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.applyQualitySettings();
    this.analyser.smoothingTimeConstant = this.settings.quality === "rich" ? 0.78 : 0.84;
    this.sourceNode.connect(this.analyser);

    this.startRendering();
  }

  detachAudio() {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this.analyser = null;
    if (this.stream) {
      const oldStream = this.stream;
      this.stream = null;
      oldStream.getTracks().forEach((track) => track.stop());
    }
  }

  setSetting(key, value) {
    this.settings[key] = value;
    if (key === "quality" && this.analyser) {
      this.applyQualitySettings();
    }
  }

  startRendering() {
    if (this.animationFrameId) {
      return;
    }
    this.lastTimestamp = performance.now();
    const tick = (timestamp) => {
      const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.05);
      this.lastTimestamp = timestamp;
      this.renderFrame(timestamp * 0.001, dt);
      this.animationFrameId = requestAnimationFrame(tick);
    };
    this.animationFrameId = requestAnimationFrame(tick);
  }

  sampleAudio(now) {
    if (!this.analyser) {
      this.audioMetrics = { bass: 0, mid: 0, treble: 0, flux: 0, pulse: 0, energy: 0, onset: 0, beat: 0 };
      return;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeDomainData);

    const bins = this.frequencyData.length;
    const bass = averageRange(this.frequencyData, 2, Math.floor(bins * 0.08)) / 255;
    const mid = averageRange(this.frequencyData, Math.floor(bins * 0.08), Math.floor(bins * 0.32)) / 255;
    const treble = averageRange(this.frequencyData, Math.floor(bins * 0.32), Math.floor(bins * 0.9)) / 255;

    let fluxTotal = 0;
    for (let i = 0; i < bins; i += 1) {
      const current = this.frequencyData[i];
      const previous = this.previousFrequencyData[i];
      const delta = current - previous;
      if (delta > 0) {
        fluxTotal += delta;
      }
      this.previousFrequencyData[i] = current;
    }
    const flux = clamp(fluxTotal / (bins * 140), 0, 1.2);

    this.bassHistory.push(bass);
    if (this.bassHistory.length > 45) {
      this.bassHistory.shift();
    }
    const bassAverage = this.bassHistory.reduce((sum, value) => sum + value, 0) / this.bassHistory.length;
    const bassSpike = clamp((bass - bassAverage * 0.82) * 2.8, 0, 1);

    const pulseThreshold = 0.34 + bassAverage * 0.22;
    let pulse = 0;
    if ((bass > pulseThreshold || bassSpike > 0.58) && now - this.lastPulseTime > 0.14) {
      this.lastPulseTime = now;
      pulse = 1;
    }

    const energy = clamp((bass * 0.48 + mid * 0.34 + treble * 0.18) * this.settings.intensity, 0, 1.8);
    const bassOnset = clamp((bass - this.smoothedAudio.bass) * 3.2, 0, 1);
    const midOnset = clamp((mid - this.smoothedAudio.mid) * 2.4, 0, 1);
    const onset = clamp(Math.max(bassOnset, midOnset, flux * 0.72), 0, 1);
    const smoothing = 0.115;
    for (const key of ["bass", "mid", "treble", "flux", "energy"]) {
      const rawValue = key === "bass" ? bass : key === "mid" ? mid : key === "treble" ? treble : key === "flux" ? flux : energy;
      this.smoothedAudio[key] += (rawValue - this.smoothedAudio[key]) * smoothing;
    }
    this.smoothedAudio.pulse = pulse;
    this.smoothedAudio.onset += (onset - this.smoothedAudio.onset) * (onset > this.smoothedAudio.onset ? 0.55 : 0.12);
    const beat = clamp(Math.max(pulse, bassSpike, flux * 0.42), 0, 1);
    this.beatEnvelope = Math.max(beat, this.beatEnvelope * 0.82);
    this.audioMetrics = { bass, mid, treble, flux, pulse, energy, onset, beat };
  }

  requestMode(modeName) {
    if (modeName === this.activeMode) {
      if (this.nextMode) {
        this.nextMode = null;
        this.transitionProgress = 0;
      }
      return;
    }
    if (modeName === this.nextMode) {
      return;
    }
    const transitionStyle = this.settings.transition;
    const shouldHardCut = transitionStyle === "hard" || (transitionStyle === "hybrid" && this.smoothedAudio.onset > 0.9);
    if (shouldHardCut) {
      this.activeMode = modeName;
      this.nextMode = null;
      this.transitionProgress = 0;
      updateModeTriggerLabel();
      return;
    }
    this.nextMode = modeName;
    this.transitionProgress = 0;
  }

  pickNextMode() {
    const candidates = this.enabledModes.filter((mode) => mode !== this.activeMode);
    if (candidates.length === 0) {
      return null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  handleModeSelection(dt) {
    const selectedMode = this.settings.mode;

    if (selectedMode !== "auto") {
      this.requestMode(selectedMode);
      return;
    }

    if (this.settings.lockMode) {
      return;
    }

    this.modeTimer += dt;
    const majorChange = this.smoothedAudio.onset > 0.68 || this.smoothedAudio.flux > 0.58;
    if (this.modeTimer >= this.nextAutoSwitchAt || (majorChange && this.modeTimer > 26)) {
      this.modeTimer = 0;
      this.nextAutoSwitchAt = randomBetween(32, 48);
      const nextMode = this.pickNextMode();
      if (nextMode) {
        this.requestMode(nextMode);
      }
    }
  }

  drawMode(modeName, alpha, now, dt) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const intensity = clamp(this.settings.intensity, 0.4, 1.8);
    const rawBass = clamp(this.audioMetrics.bass, 0, 0.72);
    const rawMid = clamp(this.audioMetrics.mid, 0, 0.68);
    const rawTreble = clamp(this.audioMetrics.treble, 0, 0.58);
    const bass = clamp(this.smoothedAudio.bass * 0.45 + rawBass * 0.55, 0, 0.72);
    const mid = clamp(this.smoothedAudio.mid * 0.45 + rawMid * 0.55, 0, 0.68);
    const treble = clamp(this.smoothedAudio.treble * 0.45 + rawTreble * 0.55, 0, 0.58);
    const flux = clamp(this.smoothedAudio.flux * 0.45 + this.audioMetrics.flux * 0.55, 0, 0.75);
    const energy = clamp(this.smoothedAudio.energy * 0.45 + this.audioMetrics.energy * 0.55, 0, 1.35);
    const onset = clamp(this.smoothedAudio.onset * 0.5 + this.audioMetrics.onset * 0.5, 0, 1);
    const beat = clamp(this.beatEnvelope, 0, 1);
    const palette = this.palettes[this.paletteIndex];

    this.ctx.save();
    this.ctx.globalAlpha = clamp(alpha, 0, 1);

    if (modeName === "fluid") {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const bassResponse = clamp(bass, 0, 0.72);
      const midResponse = clamp(mid, 0, 0.68);
      const baseRadius = Math.min(w, h) * (0.14 + bassResponse * 0.09 + beat * 0.026);
      const layers = this.settings.quality === "rich" ? 18 : 12;
      const slowTime = now * 0.28;
      for (let i = 0; i < layers; i += 1) {
        const layerT = i / layers;
        const breathing = Math.sin(slowTime + i * 0.38) * (0.018 + flux * 0.035) + beat * 0.018;
        const radius = baseRadius + layerT * Math.min(w, h) * 0.44 * (1 + breathing);
        const hue = palette.start + layerT * palette.spread * 0.7 + midResponse * 28;
        this.ctx.strokeStyle = `hsla(${hue}, 76%, ${58 - layerT * 15}%, ${0.38 - layerT * 0.22})`;
        this.ctx.lineWidth = 1.2 + (1 - layerT) * 2.6 * intensity;
        this.ctx.beginPath();
        const points = this.settings.quality === "rich" ? 144 : 96;
        for (let p = 0; p <= points; p += 1) {
          const a = (p / points) * Math.PI * 2;
          const wobble = 1 +
            Math.sin(a * 3 + slowTime * (0.75 + treble * 0.25) + i * 0.62) * (0.018 + bassResponse * 0.038) +
            Math.cos(a * 2 - slowTime * 0.35 + i * 0.24) * midResponse * 0.018;
          const x = cx + Math.cos(a) * radius * wobble;
          const y = cy + Math.sin(a) * radius * wobble;
          if (p === 0) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }
        this.ctx.closePath();
        this.ctx.stroke();
      }
    } else if (modeName === "ribbons") {
      const ribbonCount = this.settings.quality === "rich" ? 9 : 6;
      const points = this.settings.quality === "rich" ? 220 : 150;
      const bassResponse = clamp(bass, 0, 0.72);
      const midResponse = clamp(mid, 0, 0.68);
      for (let r = 0; r < ribbonCount; r += 1) {
        const t = r / Math.max(1, ribbonCount - 1);
        const yBase = h * (0.18 + t * 0.64);
        const amp = h * (0.025 + bassResponse * 0.075 + beat * 0.038) * intensity;
        const hue = palette.start + t * palette.spread * 0.68 + midResponse * 22;
        this.ctx.strokeStyle = `hsla(${hue}, 76%, ${58 + t * 8}%, ${0.5 - t * 0.26})`;
        this.ctx.lineWidth = 1.2 + (1 - t) * 2.2;
        this.ctx.beginPath();
        for (let i = 0; i <= points; i += 1) {
          const x = (i / points) * w;
          const phase = now * (0.24 + treble * 0.12) + x * 0.0028 + r * 0.72 + this.seed * 0.001;
          const y = yBase +
            Math.sin(phase) * amp +
            Math.sin(phase * 0.52 - r * 0.55) * amp * 0.34 +
            Math.cos(x * 0.0011 + now * 0.11 + r) * h * midResponse * 0.018;
          if (i === 0) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }
        this.ctx.stroke();
      }
    } else if (modeName === "bloom") {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const petals = this.settings.quality === "rich" ? 14 : 10;
      const radius = Math.min(w, h) * (0.13 + bass * 0.16 + beat * 0.04);
      for (let petal = 0; petal < petals; petal += 1) {
        const baseAngle = (petal / petals) * Math.PI * 2;
        const angleOffset = Math.sin(now * 0.11 + petal * 0.71) * (0.025 + mid * 0.025);
        const petalLength = radius * (0.78 + mid * 0.65 + onset * 0.22 + beat * 0.28);
        const hue = palette.start + petal * (palette.spread / petals) + treble * 30;
        this.ctx.strokeStyle = `hsla(${hue}, 82%, 62%, ${0.45 - petal * 0.012})`;
        this.ctx.lineWidth = 1.4 + bass * 3.2;
        this.ctx.beginPath();
        const segments = 34;
        for (let i = 0; i <= segments; i += 1) {
          const t = i / segments;
          const angle = baseAngle + angleOffset + Math.sin(t * Math.PI * 2 + now * 0.22 + petal) * 0.055;
          const r = petalLength * Math.sin(t * Math.PI) + radius * 0.32;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }
        this.ctx.stroke();
      }
    } else if (modeName === "aurora") {
      const bandCount = this.settings.quality === "rich" ? 8 : 5;
      const points = this.settings.quality === "rich" ? 240 : 150;
      for (let band = 0; band < bandCount; band += 1) {
        const t = band / Math.max(1, bandCount - 1);
        const yBase = h * (0.22 + t * 0.56);
        const amplitude = h * (0.025 + bass * 0.09 + onset * 0.025 + beat * 0.045);
        const hue = palette.start + t * palette.spread * 0.72 + treble * 26;
        this.ctx.strokeStyle = `hsla(${hue}, 78%, ${62 - t * 18}%, ${0.42 - t * 0.24})`;
        this.ctx.lineWidth = 1.2 + mid * 2.4;
        this.ctx.beginPath();
        for (let i = 0; i <= points; i += 1) {
          const x = (i / points) * w;
          const phase = x * 0.0044 + now * (0.18 + treble * 0.18) + band * 0.78 + this.seed * 0.001;
          const y = yBase +
            Math.sin(phase) * amplitude +
            Math.sin(phase * 0.43 - now * 0.08) * amplitude * 0.38 +
            mid * Math.sin(x * 0.009 + band) * h * 0.012;
          if (i === 0) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }
        this.ctx.stroke();
      }
    } else if (modeName === "orbit") {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const ringCount = this.settings.quality === "rich" ? 9 : 6;
      for (let ring = 0; ring < ringCount; ring += 1) {
        const t = ring / Math.max(1, ringCount - 1);
        const radiusX = Math.min(w, h) * (0.12 + t * 0.34) * (1 + bass * 0.09 + beat * 0.055);
        const radiusY = radiusX * (0.32 + mid * 0.24 + Math.sin(now * 0.08 + ring) * 0.025);
        const rotation = now * (0.035 + treble * 0.025) * (ring % 2 === 0 ? 1 : -1) + ring * 0.52;
        const hue = palette.start + t * palette.spread + onset * 28;
        this.ctx.strokeStyle = `hsla(${hue}, 82%, 64%, ${0.38 - t * 0.18})`;
        this.ctx.lineWidth = 1 + mid * 2;
        this.ctx.beginPath();
        const points = 90;
        for (let i = 0; i <= points; i += 1) {
          const angle = (i / points) * Math.PI * 2;
          const localRadius = 1 + Math.sin(angle * 3 + now * 0.16 + ring) * 0.018 * mid;
          const baseX = Math.cos(angle) * radiusX * localRadius;
          const baseY = Math.sin(angle) * radiusY * localRadius;
          const x = cx + baseX * Math.cos(rotation) - baseY * Math.sin(rotation);
          const y = cy + baseX * Math.sin(rotation) + baseY * Math.cos(rotation);
          if (i === 0) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }
        this.ctx.stroke();
      }
    } else if (modeName === "prism") {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const rays = this.settings.quality === "rich" ? 18 : 12;
      const radius = Math.min(w, h) * (0.24 + bass * 0.16 + beat * 0.04);
      for (let ray = 0; ray < rays; ray += 1) {
        const angle = (ray / rays) * Math.PI * 2 + now * 0.025;
        const split = (ray % 2 === 0 ? 1 : -1) * (0.08 + mid * 0.12);
        const innerRadius = radius * (0.18 + (ray % 3) * 0.04);
        const outerRadius = radius * (1 + treble * 0.08);
        const hue = palette.start + ray * (palette.spread / rays) + onset * 30;
        this.ctx.strokeStyle = `hsla(${hue}, 82%, 64%, ${0.4 - ray * 0.008})`;
        this.ctx.lineWidth = 1 + bass * 2.4;
        this.ctx.beginPath();
        this.ctx.moveTo(cx + Math.cos(angle) * innerRadius, cy + Math.sin(angle) * innerRadius);
        this.ctx.quadraticCurveTo(
          cx + Math.cos(angle + split) * radius * 0.72,
          cy + Math.sin(angle + split) * radius * 0.72,
          cx + Math.cos(angle) * outerRadius,
          cy + Math.sin(angle) * outerRadius
        );
        this.ctx.stroke();
      }
    } else if (modeName === "lissajous") {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const curves = this.settings.quality === "rich" ? 7 : 4;
      const points = this.settings.quality === "rich" ? 280 : 180;
      const sizeX = w * (0.14 + mid * 0.12 + beat * 0.018);
      const sizeY = h * (0.16 + bass * 0.12 + beat * 0.022);
      for (let curve = 0; curve < curves; curve += 1) {
        const t = curve / Math.max(1, curves - 1);
        const xFreq = 3 + (curve % 3);
        const yFreq = 2 + ((curve + 1) % 4);
        const hue = palette.start + t * palette.spread + treble * 24;
        this.ctx.strokeStyle = `hsla(${hue}, 78%, ${58 + t * 12}%, ${0.42 - t * 0.18})`;
        this.ctx.lineWidth = 1 + mid * 2.2;
        this.ctx.beginPath();
        for (let i = 0; i <= points; i += 1) {
          const a = (i / points) * Math.PI * 2;
          const x = cx + Math.sin(a * xFreq + now * (0.08 + treble * 0.04) + curve) * sizeX;
          const y = cy + Math.sin(a * yFreq + now * (0.055 + bass * 0.03)) * sizeY;
          if (i === 0) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }
        this.ctx.stroke();
      }
    } else if (modeName === "constellation") {
      const stars = this.settings.quality === "rich" ? 28 : 18;
      const cx = w * 0.5;
      const cy = h * 0.5;
      const points = [];
      for (let i = 0; i < stars; i += 1) {
        const seedA = ((i * 47) % 101) / 101;
        const seedB = ((i * 73) % 97) / 97;
        const direction = i % 5 === 0 ? -1 : 1;
        const speed = 0.006 + seedA * 0.018;
        const angle = seedB * Math.PI * 2 +
          now * speed * direction +
          treble * 0.018 * Math.sin(now * 0.09 + i);
        const orbit = Math.min(w, h) * (0.11 + ((i * 47) % 100) / 420) *
          (1 + bass * 0.055 + beat * 0.025);
        points.push({
          x: cx + Math.cos(angle) * orbit * (0.9 + mid * 0.16),
          y: cy + Math.sin(angle) * orbit * (0.62 + treble * 0.12),
          depth: seedA,
          phase: seedB * Math.PI * 2
        });
      }
      this.ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const hue = palette.start + i * (palette.spread / points.length) + onset * 32;
        const twinkle = 0.72 + Math.sin(now * (0.12 + point.depth * 0.16) + point.phase) * 0.16;
        this.ctx.fillStyle = `hsla(${hue}, 88%, 72%, ${twinkle * (0.48 + beat * 0.28)})`;
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 1.1 + point.depth * 1.4 + bass * 1.8 + beat * 1.2, 0, Math.PI * 2);
        this.ctx.fill();
        for (let j = i + 1; j < points.length; j += 1) {
          const dx = point.x - points[j].x;
          const dy = point.y - points[j].y;
          if (dx * dx + dy * dy < (Math.min(w, h) * 0.18) ** 2) {
            this.ctx.strokeStyle = `hsla(${hue}, 74%, 64%, ${0.08 + mid * 0.12})`;
            this.ctx.lineWidth = 0.8;
            this.ctx.beginPath();
            this.ctx.moveTo(point.x, point.y);
            this.ctx.lineTo(points[j].x, points[j].y);
            this.ctx.stroke();
          }
        }
      }
      this.ctx.globalCompositeOperation = "source-over";
    } else if (modeName === "tidal") {
      const bands = this.settings.quality === "rich" ? 12 : 8;
      const points = this.settings.quality === "rich" ? 220 : 140;
      for (let band = 0; band < bands; band += 1) {
        const t = band / Math.max(1, bands - 1);
        const yBase = h * (0.18 + t * 0.64);
        const amplitude = h * (0.018 + bass * 0.06 + beat * 0.025);
        const hue = palette.start + t * palette.spread + mid * 20;
        this.ctx.strokeStyle = `hsla(${hue}, 76%, ${60 - t * 12}%, ${0.36 - t * 0.12})`;
        this.ctx.lineWidth = 1 + mid * 2;
        this.ctx.beginPath();
        for (let i = 0; i <= points; i += 1) {
          const x = (i / points) * w;
          const phase = x * 0.005 + now * (0.2 + treble * 0.12) + band * 0.58;
          const y = yBase + Math.sin(phase) * amplitude + Math.sin(phase * 0.37 - now * 0.08) * amplitude * 0.42;
          if (i === 0) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }
        this.ctx.stroke();
      }
    } else if (modeName === "helix") {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const strands = 2;
      const length = this.settings.quality === "rich" ? 220 : 140;
      const radius = Math.min(w, h) * (0.12 + mid * 0.1 + beat * 0.025);
      for (let strand = 0; strand < strands; strand += 1) {
        const phaseOffset = strand * Math.PI;
        this.ctx.strokeStyle = `hsla(${palette.start + strand * palette.spread * 0.5 + treble * 26}, 82%, 64%, 0.5)`;
        this.ctx.lineWidth = 1.2 + bass * 2.4;
        this.ctx.beginPath();
        for (let i = 0; i <= length; i += 1) {
          const t = i / length;
          const angle = t * Math.PI * 5 + now * (0.12 + treble * 0.08) + phaseOffset;
          const height = (t - 0.5) * h * (0.62 + bass * 0.08);
          const perspective = 0.45 + (Math.sin(angle) + 1) * 0.275;
          const x = cx + Math.cos(angle) * radius * perspective;
          const y = cy + height;
          if (i === 0) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }
        this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }

  renderFrame(now, dt) {
    this.sampleAudio(now);
    this.handleModeSelection(dt);
    this.beatEnvelope *= Math.pow(0.72, dt);

    this.paletteTimer += dt;
    if (this.paletteTimer >= this.paletteDuration) {
      this.paletteTimer = 0;
      this.paletteDuration = randomBetween(28, 42);
      this.paletteIndex = (this.paletteIndex + 1 + Math.floor(Math.random() * (this.palettes.length - 1))) % this.palettes.length;
    }

    const fadeAmount = this.settings.quality === "rich" ? 0.055 : 0.075;
    this.ctx.fillStyle = `rgba(4, 6, 10, ${fadeAmount})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.nextMode) {
      this.transitionProgress += dt / this.transitionDuration;
      const t = clamp(this.transitionProgress, 0, 1);
      this.drawMode(this.activeMode, 1 - t, now, dt);
      this.drawMode(this.nextMode, t, now, dt);
      if (t >= 1) {
        this.activeMode = this.nextMode;
        this.nextMode = null;
        this.transitionProgress = 0;
        updateModeTriggerLabel();
      }
      return;
    }

    this.drawMode(this.activeMode, 1, now, dt);
  }
}

const canvas = document.getElementById("visCanvas");
const setupOverlay = document.getElementById("setupOverlay");
const setupTitle = setupOverlay.querySelector("h1");
const setupStatus = document.getElementById("setupStatus");
const shareBtn = document.getElementById("shareBtn");
const cancelSetupBtn = document.getElementById("cancelSetupBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const reshareBtn = document.getElementById("reshareBtn");
const controlBar = document.getElementById("controlBar");
const modePicker = document.getElementById("modePicker");
const modeTrigger = document.getElementById("modeTrigger");
const modeTriggerText = document.getElementById("modeTriggerText");
const modeMenu = document.getElementById("modeMenu");
const modeOptions = document.getElementById("modeOptions");
const selectAllModes = document.getElementById("selectAllModes");
const clearModes = document.getElementById("clearModes");
const lockToggle = document.getElementById("lockToggle");
const transitionSelect = document.getElementById("transitionSelect");
const qualitySelect = document.getElementById("qualitySelect");
const intensityRange = document.getElementById("intensityRange");
const fullscreenBtn = document.getElementById("fullscreenBtn");
let captureInProgress = false;
let refreshSetupMode = false;

const saved = readSettings();
const app = new VisualizerApp(canvas, saved);

function applyControlsFromSettings() {
  renderModePicker();
  lockToggle.checked = !!app.settings.lockMode;
  transitionSelect.value = app.settings.transition;
  qualitySelect.value = app.settings.quality;
  intensityRange.value = String(app.settings.intensity);
}

function syncSettings() {
  saveSettings(app.settings);
}

function updateModeTriggerLabel() {
  if (!modeTriggerText) {
    return;
  }
  const enabledCount = app.enabledModes.length;
  if (app.settings.mode === "auto") {
    const currentModeName = app.modeNames[app.activeMode] || "Starting";
    modeTriggerText.textContent = enabledCount === app.modeOrder.length
      ? `Auto · ${currentModeName}`
      : `Auto · ${currentModeName} · ${enabledCount}`;
  } else {
    modeTriggerText.textContent = app.modeNames[app.settings.mode] || "Auto";
  }
}

function setMode(mode) {
  app.setSetting("mode", mode);
  syncSettings();
  renderModePicker();
  modeMenu.hidden = true;
  modePicker.classList.remove("open");
  modeTrigger.setAttribute("aria-expanded", "false");
}

function updateEnabledModes(enabledModes) {
  const previousMode = app.activeMode;
  app.enabledModes = app.modeOrder.filter((mode) => enabledModes.includes(mode));
  app.setSetting("enabledModes", app.enabledModes);
  if (app.enabledModes.length === 0) {
    app.setSetting("mode", app.activeMode);
  } else if (app.enabledModes.length === 1) {
    app.setSetting("mode", app.enabledModes[0]);
    app.requestMode(app.enabledModes[0]);
  } else {
    app.setSetting("mode", "auto");
    if (!app.enabledModes.includes(previousMode)) {
      app.requestMode(app.pickNextMode());
    }
  }
  syncSettings();
  renderModePicker();
}

function renderModePicker() {
  updateModeTriggerLabel();

  modeOptions.replaceChildren();
  for (const mode of app.modeOrder) {
    const row = document.createElement("div");
    row.className = "mode-option";
    row.setAttribute("role", "menuitem");

    const onlyButton = document.createElement("button");
    onlyButton.type = "button";
    onlyButton.className = "mode-only";
    onlyButton.textContent = "Only";
    onlyButton.classList.toggle("active", app.settings.mode === mode);

    const label = document.createElement("span");
    label.textContent = app.modeNames[mode];

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = app.enabledModes.includes(mode);
    checkbox.setAttribute("aria-label", `Include ${app.modeNames[mode]} in Auto`);
    row.append(checkbox, label, onlyButton);

    onlyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      updateEnabledModes([mode]);
      setMode(mode);
      modeMenu.hidden = true;
      modePicker.classList.remove("open");
      modeTrigger.setAttribute("aria-expanded", "false");
    });
    checkbox.addEventListener("change", (event) => {
      event.stopPropagation();
      const nextEnabledModes = app.enabledModes.includes(mode)
        ? app.enabledModes.filter((enabledMode) => enabledMode !== mode)
        : [...app.enabledModes, mode];
      updateEnabledModes(nextEnabledModes);
    });
    modeOptions.appendChild(row);
  }
}

function setStatus(text, isError = false) {
  setupStatus.textContent = text;
  setupStatus.style.color = isError ? "var(--err)" : "var(--muted)";
}

function showConnectedUI() {
  controlBar.style.display = "grid";
  setupOverlay.style.display = "none";
  disconnectBtn.style.display = "inline-block";
  cancelSetupBtn.style.display = "none";
}

function showSetupUI() {
  setupOverlay.style.display = "grid";
  controlBar.style.display = "none";
  cancelSetupBtn.style.display = "inline-block";
  disconnectBtn.style.display = app.stream ? "inline-block" : "none";
}

async function requestTabAudio() {
  if (captureInProgress) {
    return;
  }
  captureInProgress = true;
  shareBtn.disabled = true;
  setStatus("Waiting for tab selection...");
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
    setStatus("Tab audio sharing requires Chrome or Edge on localhost or HTTPS.", true);
    showToast("This browser does not support tab audio capture here.", "error");
    shareBtn.disabled = false;
    captureInProgress = false;
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        suppressLocalAudioPlayback: false
      }
    });

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("No shared audio track detected.");
    }

    await app.attachStream(stream);
    audioTracks[0].addEventListener("ended", () => {
      if (app.stream !== stream) {
        return;
      }
      showSetupUI();
      setStatus("Tab audio sharing ended. Click Share Tab Audio to reconnect.", true);
      showToast("Audio sharing ended. Click Share Tab Audio to reconnect.", "error");
    });
    showConnectedUI();
    refreshSetupMode = false;
    shareBtn.textContent = "Replace Tab Audio";
    setStatus("");
    showToast("Tab audio connected. Visualizer is live.", "success");
  } catch (error) {
    const message = (error && error.message) ? error.message : "Audio share failed.";
    const errorName = error && error.name ? error.name : "";
    if (errorName === "NotAllowedError" || message.includes("Permission denied") || message.includes("NotAllowedError")) {
      setStatus("Audio share was canceled. Click Share Tab Audio to try again.", true);
      showToast("Share was canceled. Please choose a tab and enable tab audio.", "error");
      return;
    }
    if (message.includes("No shared audio track")) {
      setStatus("No tab audio found. Re-open share and enable tab audio.", true);
      showToast("No audio track detected. Make sure tab audio is enabled.", "error");
      return;
    }
    setStatus("Could not connect tab audio. Click Share Tab Audio to retry.", true);
    showToast("Unable to connect tab audio. Please retry.", "error");
  } finally {
    shareBtn.disabled = false;
    captureInProgress = false;
  }
}

shareBtn.addEventListener("click", () => {
  requestTabAudio();
});

reshareBtn.addEventListener("click", () => {
  refreshSetupMode = true;
  setupTitle.textContent = "Refresh Chrome tab audio";
  shareBtn.textContent = "Replace Tab Audio";
  cancelSetupBtn.style.display = "inline-block";
  disconnectBtn.style.display = "inline-block";
  showSetupUI();
  setStatus("Click Share Tab Audio to switch sources.");
});

cancelSetupBtn.addEventListener("click", () => {
  setupOverlay.style.display = "none";
  if (app.stream) {
    controlBar.style.display = "grid";
  }
  refreshSetupMode = false;
});

disconnectBtn.addEventListener("click", () => {
  app.detachAudio();
  refreshSetupMode = false;
  setupTitle.textContent = "Connect Chrome tab audio";
  shareBtn.textContent = "Share Tab Audio";
  cancelSetupBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  showSetupUI();
  setStatus("Audio disconnected.");
  showToast("Tab audio disconnected.", "success");
});

modeTrigger.addEventListener("click", () => {
  const willOpen = modeMenu.hidden;
  modeMenu.hidden = !willOpen;
  modePicker.classList.toggle("open", willOpen);
  modeTrigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
});

selectAllModes.addEventListener("click", () => {
  updateEnabledModes([...app.modeOrder]);
});

clearModes.addEventListener("click", () => {
  updateEnabledModes([]);
});

document.addEventListener("pointerdown", (event) => {
  if (!modePicker.contains(event.target)) {
    modeMenu.hidden = true;
    modePicker.classList.remove("open");
    modeTrigger.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    modeMenu.hidden = true;
    modePicker.classList.remove("open");
    modeTrigger.setAttribute("aria-expanded", "false");
  }
});

lockToggle.addEventListener("change", (event) => {
  app.setSetting("lockMode", !!event.target.checked);
  syncSettings();
});

transitionSelect.addEventListener("change", (event) => {
  app.setSetting("transition", event.target.value);
  syncSettings();
});

qualitySelect.addEventListener("change", (event) => {
  app.setSetting("quality", event.target.value);
  syncSettings();
  showToast(`Quality set to ${event.target.value === "rich" ? "Rich" : "Smooth"}.`, "success");
});

intensityRange.addEventListener("input", (event) => {
  app.setSetting("intensity", Number(event.target.value));
  syncSettings();
});

fullscreenBtn.addEventListener("click", async () => {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
    return;
  }
  await document.exitFullscreen();
});

applyControlsFromSettings();
app.applyQualitySettings();
showSetupUI();
setStatus("Ready when you are.");

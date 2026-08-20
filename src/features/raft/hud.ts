export interface RaftHud {
  readonly element: HTMLDivElement;
  update(speedKnots: number, sailPower: number): void;
  dispose(): void;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  return element;
}

export function createRaftHud(canvas: HTMLCanvasElement): RaftHud {
  const parent = canvas.parentElement ?? document.body;
  const element = createElement('div', 'raft-hud');
  element.dataset.raftHud = 'true';
  element.dataset.qa = 'water-hud';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Water navigation HUD');

  const brand = createElement('div', 'raft-hud__brand');
  brand.dataset.raftBrand = 'true';
  brand.dataset.qa = 'brand';
  brand.textContent = 'WATER';

  const compass = createElement('div', 'raft-hud__compass');
  compass.dataset.raftCompass = 'true';
  compass.dataset.qa = 'compass';
  compass.setAttribute('aria-label', 'Compass W N E');
  const compassLine = createElement('span', 'raft-hud__compass-line');
  compass.append(compassLine);
  for (const direction of ['W', 'N', 'E']) {
    const marker = createElement('span', 'raft-hud__compass-marker');
    marker.textContent = direction;
    compass.append(marker);
  }

  const wind = createElement('div', 'raft-hud__wind');
  wind.dataset.raftWind = 'true';
  wind.dataset.qa = 'wind';
  const windLabel = createElement('span', 'raft-hud__wind-label');
  windLabel.textContent = 'WIND 12 KN';
  const windArrow = createElement('span', 'raft-hud__wind-arrow');
  windArrow.setAttribute('aria-hidden', 'true');
  windArrow.textContent = '↗';
  wind.append(windLabel, windArrow);

  const controls = createElement('div', 'raft-hud__controls');
  controls.dataset.raftControls = 'true';
  controls.dataset.qa = 'controls';
  controls.setAttribute('aria-label', 'Raft controls: WASD steer, drag look');
  const steer = createElement('div', 'raft-hud__control-row');
  const keys = createElement('span', 'raft-hud__keys');
  keys.setAttribute('aria-hidden', 'true');
  for (const key of ['W', 'A', 'S', 'D']) {
    const keyElement = createElement('kbd', 'raft-hud__key');
    keyElement.textContent = key;
    keys.append(keyElement);
  }
  const steerLabel = createElement('span', 'raft-hud__control-label');
  steerLabel.textContent = 'STEER';
  steer.append(keys, steerLabel);

  const look = createElement('div', 'raft-hud__control-row');
  const lookLabel = createElement('span', 'raft-hud__control-label');
  lookLabel.textContent = 'DRAG LOOK';
  look.append(lookLabel);
  controls.append(steer, look);

  const speed = createElement('div', 'raft-hud__speed');
  speed.dataset.raftSpeed = 'true';
  speed.dataset.qa = 'speed';
  speed.setAttribute('aria-live', 'polite');
  speed.textContent = '0.0 KN';

  const sail = createElement('div', 'raft-hud__sail');
  sail.dataset.raftSail = 'true';
  sail.dataset.qa = 'sail';
  const sailLabel = createElement('div', 'raft-hud__sail-label');
  sailLabel.textContent = 'SAIL';
  const sailGauge = createElement('div', 'raft-hud__sail-gauge');
  sailGauge.setAttribute('role', 'meter');
  sailGauge.setAttribute('aria-label', 'Sail');
  sailGauge.setAttribute('aria-valuemin', '0');
  sailGauge.setAttribute('aria-valuemax', '100');
  const sailFill = createElement('div', 'raft-hud__sail-fill');
  sailFill.dataset.raftSailFill = 'true';
  sailGauge.append(sailFill);
  const sailPercent = createElement('div', 'raft-hud__sail-percent');
  sailPercent.dataset.raftSailPercent = 'true';
  sail.append(sailLabel, sailGauge, sailPercent);

  element.append(brand, compass, wind, controls, speed, sail);
  parent.append(element);

  return {
    element,
    update(speedKnots: number, sailPower: number): void {
      const safeSailPower = Math.min(Math.max(sailPower, 0), 1);
      speed.textContent = `${Math.max(speedKnots, 0).toFixed(1)} KN`;
      sailFill.style.height = `${safeSailPower * 100}%`;
      sailPercent.textContent = `${Math.round(safeSailPower * 100)}%`;
      sailGauge.setAttribute('aria-valuenow', `${Math.round(safeSailPower * 100)}`);
    },
    dispose(): void {
      element.remove();
    },
  };
}

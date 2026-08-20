const DEFAULT_CANVAS_SELECTORS = Object.freeze([
  '[data-qa="water-canvas"]',
  '[data-testid="water-canvas"]',
  '[data-hud="water-canvas"]',
  '.runtime-canvas',
  'canvas',
]);

const DEFAULT_HUD_SELECTORS = Object.freeze([
  '[data-qa]',
  '[data-testid]',
  '[data-hud]',
  '[role="status"]',
  '[role="alert"]',
]);

const WATER_CANVAS_DATA_QA = 'water-canvas';

/**
 * The integrated Water HUD contract. Requirements use data-qa markers first,
 * while copy patterns tolerate dynamic numeric values and whitespace changes.
 */
export const WATER_HUD_REQUIREMENTS = Object.freeze([
  Object.freeze({
    key: 'water-hud',
    dataAttribute: 'data-qa',
    dataValue: 'water-hud',
  }),
  Object.freeze({
    key: 'brand',
    dataAttribute: 'data-qa',
    dataValue: 'brand',
    copy: 'WATER',
  }),
  Object.freeze({
    key: 'compass',
    dataAttribute: 'data-qa',
    dataValue: 'compass',
    copy: { pattern: 'W\\s*N\\s*E', flags: 'i' },
  }),
  Object.freeze({
    key: 'wind',
    dataAttribute: 'data-qa',
    dataValue: 'wind',
    copy: { pattern: '\\bWIND\\s+\\d+(?:\\.\\d+)?\\s*KN\\b', flags: 'i' },
  }),
  Object.freeze({
    key: 'controls',
    dataAttribute: 'data-qa',
    dataValue: 'controls',
    copy: { pattern: 'WASD\\s*STEER.*DRAG\\s*LOOK', flags: 'i' },
  }),
  Object.freeze({
    key: 'speed',
    dataAttribute: 'data-qa',
    dataValue: 'speed',
    copy: { pattern: '(?:SPEED\\s*)?\\d+(?:\\.\\d+)?\\s*KN\\b', flags: 'i' },
  }),
  Object.freeze({
    key: 'sail',
    dataAttribute: 'data-qa',
    dataValue: 'sail',
    copy: { pattern: '\\bSAIL\\b.*\\d+(?:\\.\\d+)?\\s*%', flags: 'i' },
  }),
]);

const MAX_TEXT_LENGTH = 240;
const LAYOUT_EPSILON = 1;

function finiteNumber(value, fallback = null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value, fallback = null) {
  const number = finiteNumber(value, fallback);
  return number !== null && number > 0 ? number : fallback;
}

function compactText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeAttribute(element, name) {
  try {
    return element?.getAttribute?.(name) ?? null;
  } catch {
    return null;
  }
}

function safeQueryAll(scope, selector) {
  if (!scope || typeof scope.querySelectorAll !== 'function') {
    return [];
  }
  try {
    return [...scope.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function uniqueNodes(nodes) {
  return [...new Set(nodes.filter(Boolean))];
}

function normalizeSelectors(value, fallback) {
  const selectors = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : fallback;
  return selectors.filter((selector) => typeof selector === 'string' && selector.length > 0);
}

function queryFirstWithSelector(scope, selectors) {
  for (const selector of selectors) {
    const node = safeQueryAll(scope, selector)[0];
    if (node) {
      return { node, selector };
    }
  }
  return { node: null, selector: null };
}

function safeRect(element) {
  try {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) {
      return null;
    }
    const left = finiteNumber(rect.left, 0);
    const top = finiteNumber(rect.top, 0);
    const width = Math.max(0, finiteNumber(rect.width, 0));
    const height = Math.max(0, finiteNumber(rect.height, 0));
    return {
      x: left,
      y: top,
      left,
      top,
      right: finiteNumber(rect.right, left + width),
      bottom: finiteNumber(rect.bottom, top + height),
      width,
      height,
    };
  } catch {
    return null;
  }
}

function safeComputedStyle(windowObject, element) {
  try {
    return windowObject?.getComputedStyle?.(element) ?? null;
  } catch {
    return null;
  }
}

function isVisibleElement(windowObject, element, rect = safeRect(element)) {
  if (!element || element.hidden || safeAttribute(element, 'aria-hidden') === 'true') {
    return false;
  }
  const style = safeComputedStyle(windowObject, element);
  if (style) {
    const opacity = Number.parseFloat(style.opacity);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
    if (Number.isFinite(opacity) && opacity <= 0) {
      return false;
    }
  }
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function readDataAttributes(element) {
  const attributes = {};
  try {
    for (const attribute of [...(element?.attributes ?? [])]) {
      if (attribute.name.startsWith('data-')) {
        attributes[attribute.name] = compactText(attribute.value, 120);
      }
    }
  } catch {
    return attributes;
  }
  return attributes;
}

function readElementEvidence(windowObject, element) {
  if (!element) {
    return {
      found: false,
      visible: false,
    };
  }
  const rect = safeRect(element);
  return {
    found: true,
    tagName: String(element.tagName ?? '').toLowerCase() || null,
    id: safeAttribute(element, 'id'),
    className: compactText(element.className, 160) || null,
    role: safeAttribute(element, 'role'),
    ariaLabel: safeAttribute(element, 'aria-label'),
    text: compactText(element.textContent),
    visible: isVisibleElement(windowObject, element, rect),
    rect,
    dataAttributes: readDataAttributes(element),
  };
}

function readLocation(windowObject) {
  try {
    const location = windowObject.location;
    return {
      href: location?.href ?? null,
      origin: location?.origin ?? null,
      pathname: location?.pathname ?? null,
      search: location?.search ?? null,
      hash: location?.hash ?? null,
    };
  } catch {
    return {
      href: null,
      origin: null,
      pathname: null,
      search: null,
      hash: null,
    };
  }
}

function readActiveElement(documentObject, windowObject) {
  const activeElement = documentObject?.activeElement ?? null;
  if (!activeElement) {
    return null;
  }
  return readElementEvidence(windowObject, activeElement);
}

function inspectCanvas(windowObject, canvas, selector, viewport, requireWaterMarker) {
  if (!canvas) {
    return {
      found: false,
      selector: null,
      visible: false,
      nonzero: false,
      waterMarkerMatched: false,
      markerRequired: requireWaterMarker,
      fitsViewport: false,
      css: { width: 0, height: 0, rect: null },
      backing: { width: 0, height: 0 },
    };
  }
  const rect = safeRect(canvas);
  const cssWidth = positiveNumber(rect?.width, 0);
  const cssHeight = positiveNumber(rect?.height, 0);
  const backingWidth = positiveNumber(canvas.width, 0);
  const backingHeight = positiveNumber(canvas.height, 0);
  const visible = isVisibleElement(windowObject, canvas, rect);
  const waterMarkerMatched = safeAttribute(canvas, 'data-qa') === WATER_CANVAS_DATA_QA;
  const fitsViewport = Boolean(
    rect
      && viewport.width !== null
      && viewport.height !== null
      && rect.left >= -LAYOUT_EPSILON
      && rect.top >= -LAYOUT_EPSILON
      && rect.right <= viewport.width + LAYOUT_EPSILON
      && rect.bottom <= viewport.height + LAYOUT_EPSILON,
  );

  return {
    ...readElementEvidence(windowObject, canvas),
    selector,
    visible,
    nonzero: cssWidth > 0 && cssHeight > 0 && backingWidth > 0 && backingHeight > 0,
    waterMarkerMatched,
    markerRequired: requireWaterMarker,
    fitsViewport,
    css: {
      width: cssWidth,
      height: cssHeight,
      rect,
    },
    backing: {
      width: backingWidth,
      height: backingHeight,
    },
    focusable: typeof canvas.tabIndex === 'number' && canvas.tabIndex >= 0,
    tabIndex: finiteNumber(canvas.tabIndex),
  };
}

function inspectRendererSurface(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    return {
      found: false,
      contextAvailable: false,
      contextType: null,
      contextLost: null,
      drawingBuffer: { width: 0, height: 0 },
      attempts: [],
      ok: false,
    };
  }

  let context = null;
  let contextType = null;
  const attempts = [];
  for (const type of ['webgl2', 'webgl', 'experimental-webgl']) {
    try {
      context = canvas.getContext(type);
      attempts.push({ type, available: Boolean(context) });
    } catch (error) {
      attempts.push({ type, available: false, error: compactText(error?.message ?? error, 160) });
    }
    if (context) {
      contextType = type;
      break;
    }
  }

  const drawingBufferWidth = positiveNumber(context?.drawingBufferWidth, 0);
  const drawingBufferHeight = positiveNumber(context?.drawingBufferHeight, 0);
  let contextLost = null;
  try {
    contextLost = typeof context?.isContextLost === 'function' ? context.isContextLost() : null;
  } catch {
    contextLost = null;
  }
  const drawingBufferNonzero = drawingBufferWidth > 0 && drawingBufferHeight > 0;

  return {
    found: true,
    contextAvailable: Boolean(context),
    contextType,
    contextLost,
    drawingBuffer: {
      width: drawingBufferWidth,
      height: drawingBufferHeight,
    },
    drawingBufferNonzero,
    attempts,
    ok: Boolean(context && contextLost !== true && drawingBufferNonzero),
    note: 'Context and drawing-buffer evidence establish a renderer surface; screenshot inspection establishes visible pixels.',
  };
}

function inspectViewport(documentObject, windowObject, canvas) {
  const width = positiveNumber(windowObject.innerWidth);
  const height = positiveNumber(windowObject.innerHeight);
  const devicePixelRatio = positiveNumber(windowObject.devicePixelRatio, 1);
  const visualViewport = windowObject.visualViewport;
  const documentElement = documentObject.documentElement;
  const body = documentObject.body;
  const documentClientWidth = positiveNumber(documentElement?.clientWidth, 0);
  const documentClientHeight = positiveNumber(documentElement?.clientHeight, 0);
  const documentScrollWidth = positiveNumber(documentElement?.scrollWidth, 0);
  const documentScrollHeight = positiveNumber(documentElement?.scrollHeight, 0);
  const bodyClientWidth = positiveNumber(body?.clientWidth, 0);
  const bodyClientHeight = positiveNumber(body?.clientHeight, 0);
  const bodyScrollWidth = positiveNumber(body?.scrollWidth, 0);
  const bodyScrollHeight = positiveNumber(body?.scrollHeight, 0);
  const clientWidth = Math.max(documentClientWidth, bodyClientWidth);
  const clientHeight = Math.max(documentClientHeight, bodyClientHeight);
  const scrollWidth = Math.max(documentScrollWidth, bodyScrollWidth);
  const scrollHeight = Math.max(documentScrollHeight, bodyScrollHeight);
  const horizontalOverflow = scrollWidth > clientWidth + LAYOUT_EPSILON;
  const verticalOverflow = scrollHeight > clientHeight + LAYOUT_EPSILON;
  const canvasRect = safeRect(canvas);
  const canvasFitsViewport = Boolean(
    canvasRect
      && width !== null
      && height !== null
      && canvasRect.left >= -LAYOUT_EPSILON
      && canvasRect.top >= -LAYOUT_EPSILON
      && canvasRect.right <= width + LAYOUT_EPSILON
      && canvasRect.bottom <= height + LAYOUT_EPSILON,
  );
  const bodyStyle = safeComputedStyle(windowObject, body);

  return {
    width,
    height,
    devicePixelRatio,
    visualViewport: visualViewport
      ? {
        width: positiveNumber(visualViewport.width),
        height: positiveNumber(visualViewport.height),
        offsetLeft: finiteNumber(visualViewport.offsetLeft, 0),
        offsetTop: finiteNumber(visualViewport.offsetTop, 0),
      }
      : null,
    document: {
      clientWidth,
      clientHeight,
      scrollWidth,
      scrollHeight,
      horizontalOverflow,
      verticalOverflow,
    },
    body: {
      clientWidth: bodyClientWidth,
      clientHeight: bodyClientHeight,
      scrollWidth: bodyScrollWidth,
      scrollHeight: bodyScrollHeight,
      computedOverflow: bodyStyle?.overflow ?? null,
      computedOverflowX: bodyStyle?.overflowX ?? null,
      computedOverflowY: bodyStyle?.overflowY ?? null,
    },
    canvasRect,
    canvasFitsViewport,
    ok: Boolean(
      width !== null
        && height !== null
        && width > 0
        && height > 0
        && !horizontalOverflow
        && !verticalOverflow
        && canvasFitsViewport,
    ),
  };
}

function validDataAttribute(attribute) {
  return typeof attribute === 'string' && /^data-[a-z0-9_-]+$/i.test(attribute);
}

function queryDataAttribute(scope, attribute, value) {
  if (!validDataAttribute(attribute) || value === undefined || value === null) {
    return [];
  }
  return safeQueryAll(scope, `[${attribute}]`).filter((element) => safeAttribute(element, attribute) === String(value));
}

function requirementSelectors(requirement) {
  if (Array.isArray(requirement.selectors)) {
    return requirement.selectors.filter((selector) => typeof selector === 'string' && selector.length > 0);
  }
  if (typeof requirement.selector === 'string' && requirement.selector.length > 0) {
    return [requirement.selector];
  }
  return [];
}

function textForElement(element) {
  return [
    element?.textContent,
    safeAttribute(element, 'aria-label'),
    safeAttribute(element, 'title'),
  ].filter(Boolean).map((value) => compactText(value)).join(' ');
}

function copyMatches(element, expected) {
  if (expected === undefined || expected === null || expected === '') {
    return true;
  }
  const actual = textForElement(element);
  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    return expected.test(actual);
  }
  if (typeof expected === 'object' && typeof expected.pattern === 'string') {
    try {
      return new RegExp(expected.pattern, expected.flags ?? '').test(actual);
    } catch {
      return false;
    }
  }
  return actual.includes(String(expected));
}

function inspectHud(documentObject, windowObject, requiredHud) {
  const discoveryNodes = uniqueNodes(
    normalizeSelectors(null, DEFAULT_HUD_SELECTORS).flatMap((selector) => safeQueryAll(documentObject, selector)),
  ).slice(0, 64);
  const discovered = discoveryNodes.map((element) => readElementEvidence(windowObject, element));
  const requirements = Array.isArray(requiredHud) ? requiredHud : [];
  const required = requirements.map((rawRequirement, index) => {
    const requirement = typeof rawRequirement === 'string'
      ? { key: rawRequirement, dataAttribute: 'data-qa', dataValue: rawRequirement }
      : (rawRequirement ?? {});
    const selectors = requirementSelectors(requirement);
    let element = null;
    let matchedBy = null;
    for (const selector of selectors) {
      element = safeQueryAll(documentObject, selector)[0] ?? null;
      if (element) {
        matchedBy = selector;
        break;
      }
    }
    if (!element && requirement.dataAttribute) {
      const dataValue = requirement.dataValue ?? requirement.value ?? requirement.key;
      element = queryDataAttribute(documentObject, requirement.dataAttribute, dataValue)[0] ?? null;
      if (element) {
        matchedBy = `${requirement.dataAttribute}=${String(dataValue)}`;
      }
    }
    const elementEvidence = readElementEvidence(windowObject, element);
    const visibleRequired = requirement.visible !== false;
    const copyExpected = requirement.copy ?? requirement.text;
    const copyMatched = element ? copyMatches(element, copyExpected) : false;
    const ok = Boolean(
      element
        && (!visibleRequired || elementEvidence.visible)
        && copyMatched,
    );
    return {
      key: String(requirement.key ?? `hud-${index + 1}`),
      matchedBy,
      visibleRequired,
      copyExpected: copyExpected ?? null,
      copyActual: element ? textForElement(element) : null,
      copyMatched,
      ...elementEvidence,
      ok,
    };
  });

  return {
    requiredConfigured: required.length > 0,
    required,
    discovered,
    ok: required.length > 0 ? required.every((requirement) => requirement.ok) : null,
    note: required.length > 0
      ? 'Requirements were evaluated with data attributes or explicit selectors first.'
      : 'No product HUD requirements were supplied; pass requiredHud after the integrated HUD contract is recorded.',
  };
}

function inspectRuntimeDiagnostics(documentObject, windowObject) {
  const loadingMatch = queryFirstWithSelector(documentObject, [
    '[data-qa="runtime-loading"]',
    '[data-testid="runtime-loading"]',
    '.runtime-loading',
  ]);
  const statusMatch = queryFirstWithSelector(documentObject, [
    '[data-qa="runtime-status"]',
    '[data-testid="runtime-status"]',
    '.runtime-status',
  ]);
  const fatalMatch = queryFirstWithSelector(documentObject, [
    '[data-qa="runtime-fatal"]',
    '[data-testid="runtime-fatal"]',
    '.runtime-fatal',
    '[role="alert"]',
  ]);
  const visibleAlerts = uniqueNodes([
    ...safeQueryAll(documentObject, '[role="alert"]'),
    ...safeQueryAll(documentObject, '[data-qa-error]'),
  ]).filter((element) => isVisibleElement(windowObject, element));
  const loading = loadingMatch.node ? {
    ...readElementEvidence(windowObject, loadingMatch.node),
    selector: loadingMatch.selector,
    phase: safeAttribute(loadingMatch.node, 'data-phase'),
  } : { found: false, visible: false, selector: null, phase: null };
  const status = statusMatch.node ? {
    ...readElementEvidence(windowObject, statusMatch.node),
    selector: statusMatch.selector,
  } : { found: false, visible: false, selector: null };
  const fatal = fatalMatch.node ? {
    ...readElementEvidence(windowObject, fatalMatch.node),
    selector: fatalMatch.selector,
  } : { found: false, visible: false, selector: null };

  return {
    loading,
    status,
    fatal,
    visibleAlertCount: visibleAlerts.length,
    visibleAlerts: visibleAlerts.map((element) => readElementEvidence(windowObject, element)),
    ok: !fatal.visible && visibleAlerts.length === 0,
  };
}

function inspectInputDiagnostics(documentObject, windowObject, canvas) {
  if (!canvas) {
    return {
      targetFound: false,
      focusable: false,
      pointerTargetReady: false,
      dragTargetReady: false,
      tabIndex: null,
      pointerEvents: null,
      touchAction: null,
      ariaLabel: null,
      activeElement: readActiveElement(documentObject, windowObject),
    };
  }
  const style = safeComputedStyle(windowObject, canvas);
  const visible = isVisibleElement(windowObject, canvas);
  const focusable = typeof canvas.tabIndex === 'number' && canvas.tabIndex >= 0 && !canvas.hidden;
  const pointerEvents = style?.pointerEvents ?? null;
  const touchAction = style?.touchAction ?? null;
  return {
    targetFound: true,
    focusable,
    pointerTargetReady: visible && pointerEvents !== 'none',
    dragTargetReady: visible && pointerEvents !== 'none' && touchAction !== 'auto',
    tabIndex: finiteNumber(canvas.tabIndex),
    pointerEvents,
    touchAction,
    ariaLabel: safeAttribute(canvas, 'aria-label'),
    activeElement: readActiveElement(documentObject, windowObject),
    note: 'Run click/focus, key, and pointer drag actions in the coordinator runner, then collect again to capture the post-action state.',
  };
}

function inspectResizeDiagnostics(windowObject, viewport) {
  return {
    resizeEventSupported: typeof windowObject.addEventListener === 'function',
    resizeObserverAvailable: typeof windowObject.ResizeObserver === 'function',
    currentViewport: {
      width: viewport.width,
      height: viewport.height,
      devicePixelRatio: viewport.devicePixelRatio,
    },
    canvasRect: viewport.canvasRect,
    bodyOverflow: {
      horizontal: viewport.document.horizontalOverflow,
      vertical: viewport.document.verticalOverflow,
    },
    note: 'Collect once before and after a viewport resize; compare dimensions, canvas rect, and overflow fields.',
  };
}

/**
 * Collect browser-side smoke evidence. The module has no import-time DOM side
 * effects, so an In-app Browser runner can import it from /qa/browser-smoke.mjs.
 *
 * The integrated Water HUD requirements are used by default. Callers can pass
 * a reviewed `requiredHud` list for a variant, or `requiredHud: []` when they
 * intentionally want layout-only diagnostics. Prefer data-attribute
 * requirements, such as `{ key: 'status', dataAttribute: 'data-qa', dataValue: 'status', copy: 'Ready' }`.
 */
export function collectBrowserEvidence({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  canvasSelectors = DEFAULT_CANVAS_SELECTORS,
  requiredHud = WATER_HUD_REQUIREMENTS,
  requireWaterMarker = true,
} = {}) {
  if (!documentObject || !windowObject) {
    throw new Error('collectBrowserEvidence must run in a browser document.');
  }

  const app = documentObject.querySelector?.('#app') ?? null;
  const canvasMatch = queryFirstWithSelector(
    documentObject,
    normalizeSelectors(canvasSelectors, DEFAULT_CANVAS_SELECTORS),
  );
  const viewportWithCanvas = inspectViewport(documentObject, windowObject, canvasMatch.node);
  const canvas = inspectCanvas(
    windowObject,
    canvasMatch.node,
    canvasMatch.selector,
    viewportWithCanvas,
    requireWaterMarker,
  );
  const renderer = inspectRendererSurface(canvasMatch.node);
  const hud = inspectHud(documentObject, windowObject, requiredHud);
  const runtime = inspectRuntimeDiagnostics(documentObject, windowObject);
  const input = inspectInputDiagnostics(documentObject, windowObject, canvasMatch.node);
  const resize = inspectResizeDiagnostics(windowObject, viewportWithCanvas);
  const page = {
    title: compactText(documentObject.title, 160) || null,
    readyState: documentObject.readyState ?? null,
    location: readLocation(windowObject),
    appMount: readElementEvidence(windowObject, app),
  };
  const checks = {
    canvasVisibleNonzero: {
      ok: canvas.found
        && canvas.visible
        && canvas.nonzero
        && (!requireWaterMarker || canvas.waterMarkerMatched),
      found: canvas.found,
      visible: canvas.visible,
      nonzero: canvas.nonzero,
      markerRequired: requireWaterMarker,
      waterMarkerMatched: canvas.waterMarkerMatched,
    },
    viewportFitAndBodyOverflow: {
      ok: viewportWithCanvas.ok,
      canvasFitsViewport: viewportWithCanvas.canvasFitsViewport,
      horizontalOverflow: viewportWithCanvas.document.horizontalOverflow,
      verticalOverflow: viewportWithCanvas.document.verticalOverflow,
    },
    rendererSurface: {
      ok: renderer.ok,
      contextAvailable: renderer.contextAvailable,
      contextType: renderer.contextType,
      drawingBufferNonzero: renderer.drawingBufferNonzero,
      contextLost: renderer.contextLost,
    },
    requiredHud: {
      ok: hud.ok,
      configured: hud.requiredConfigured,
      requirements: hud.required,
    },
    runtimeDiagnostics: {
      ok: runtime.ok,
      visibleFatalOrAlert: runtime.visibleAlertCount > 0 || runtime.fatal.visible,
    },
  };
  const blockingChecks = Object.values(checks).filter((check) => typeof check.ok === 'boolean' && check.ok !== null);

  return {
    schemaVersion: 1,
    collectedAt: new Date().toISOString(),
    ok: blockingChecks.every((check) => check.ok),
    page,
    viewport: viewportWithCanvas,
    canvas,
    renderer,
    hud,
    diagnostics: {
      runtime,
      input,
      resize,
    },
    checks,
    notes: [
      'Console and uncaught page errors must be captured by the coordinator browser runner around navigation and interaction.',
      'The renderer check proves a live WebGL drawing buffer; coordinator screenshots provide visible-pixel evidence.',
      'Performance budgets remain deferred until device, browser, measurement method, and budgets are recorded.',
    ],
  };
}

export default collectBrowserEvidence;

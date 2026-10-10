import React, { useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';

let frontLayer = 40;

export default function FloatingWindow({ enabled = true, title, label, testId, className = '',
  corner = 'bottom-right', collapseContent = true, onExpand, onClose, onMinimizeChange, children }) {
  const ref = useRef(null);
  const position = useRef(null);
  const drag = useRef(null);
  const frame = useRef(null);
  const pending = useRef(null);
  const savedPosition = useRef(null);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);

  function viewport() {
    const view = window.visualViewport;
    return { width: view?.width ?? window.innerWidth, height: view?.height ?? window.innerHeight,
      left: view?.offsetLeft ?? 0, top: view?.offsetTop ?? 0 };
  }

  function place(x, y) {
    const area = ref.current;
    if (!area) return;
    const { width, height, left, top } = viewport();
    area.style.setProperty('--available-width', `${Math.max(0, width - 24)}px`);
    area.style.setProperty('--available-height', `${Math.max(0, height - 24)}px`);
    position.current = {
      x: Math.max(left + 12, Math.min(x, left + width - area.offsetWidth - 12)),
      y: Math.max(top + 12, Math.min(y, top + height - area.offsetHeight - 12)),
    };
    area.style.left = `${position.current.x}px`;
    area.style.top = `${position.current.y}px`;
  }

  function resize(width, height) {
    const area = ref.current;
    if (!area) return;
    const view = viewport();
    const maxWidth = Math.max(0, view.left + view.width - (position.current?.x ?? 12) - 12);
    const maxHeight = Math.max(0, view.top + view.height - (position.current?.y ?? 12) - 12);
    const dimensions = { width: Math.min(maxWidth, Math.max(Math.min(320, maxWidth), width)),
      height: Math.min(maxHeight, Math.max(Math.min(320, maxHeight), height)) };
    area.style.setProperty('--window-width', `${dimensions.width}px`);
    area.style.setProperty('--window-height', `${dimensions.height}px`);
    area.setAttribute('data-resized', 'true');
  }

  function toggleMaximize() {
    if (!maximized) savedPosition.current = position.current && { ...position.current };
    setMinimized(false);
    onMinimizeChange?.(false);
    setMaximized(!maximized);
  }

  function reset() {
    const area = ref.current;
    if (!area) return;
    const width = window.visualViewport?.width ?? window.innerWidth;
    const height = window.visualViewport?.height ?? window.innerHeight;
    place(corner === 'top-left' ? (width > 1240 ? 260 : 12) : width - area.offsetWidth - 24,
      corner.startsWith('top') ? (height > 650 ? 104 : 12) : height - area.offsetHeight - 24);
  }

  useLayoutEffect(() => {
    if (!enabled) { setMinimized(false); setMaximized(false); onMinimizeChange?.(false); return; }
    if (maximized) place(viewport().left + 12, viewport().top + 12);
    else if (position.current) place(position.current.x, position.current.y);
    else reset();
    const fit = () => {
      if (maximized) place(viewport().left + 12, viewport().top + 12);
      else if (position.current) place(position.current.x, position.current.y);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(ref.current);
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('scroll', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('scroll', fit);
      cancelAnimationFrame(frame.current);
      drag.current = null;
    };
  }, [enabled, maximized]);

  useLayoutEffect(() => {
    if (enabled && !maximized && savedPosition.current) {
      place(savedPosition.current.x, savedPosition.current.y);
      savedPosition.current = null;
    }
  }, [maximized, enabled]);

  function finish(event) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    cancelAnimationFrame(frame.current);
    if (pending.current) {
      if (drag.current.resize) resize(pending.current.width, pending.current.height);
      else place(pending.current.x, pending.current.y);
    }
    pending.current = null;
    drag.current = null;
    ref.current?.removeAttribute('data-dragging');
    ref.current?.removeAttribute('data-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div ref={ref} className={`${enabled ? 'floating-window' : 'inline-window'} ${className}
    ${minimized && enabled ? 'is-minimized' : ''} ${maximized && enabled ? 'is-maximized' : ''} ${collapseContent ? 'collapse-content' : ''}`}
    role={enabled ? 'region' : undefined} aria-label={enabled ? `${label} window` : undefined}
    data-testid={testId} onPointerDownCapture={() => {
      if (enabled) ref.current.style.zIndex = String(++frontLayer);
    }} onFocusCapture={() => { if (enabled) ref.current.style.zIndex = String(++frontLayer); }}>
    {enabled && <header className="floating-titlebar">
      <button type="button" className="window-drag-handle" aria-label={`Move ${label} window`}
        title="Drag to move. Arrow keys move; Home resets position. Double-click to maximize."
        onDoubleClick={toggleMaximize} onPointerDown={(event) => {
          if (event.button !== 0 || maximized) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = ref.current.getBoundingClientRect();
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
          pending.current = null;
          ref.current.setAttribute('data-dragging', 'true');
        }} onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          pending.current = { x: start.left + event.clientX - start.x, y: start.top + event.clientY - start.y };
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => {
            if (pending.current) place(pending.current.x, pending.current.y);
          });
        }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onKeyDown={(event) => {
          if (maximized) return;
          if (event.key === 'Home') { event.preventDefault(); reset(); return; }
          const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          if (!directions[event.key] || !position.current) return;
          event.preventDefault();
          const [x, y] = directions[event.key];
          const step = event.shiftKey ? 40 : 12;
          place(position.current.x + x * step, position.current.y + y * step);
        }}><Icon name="grip" size={16} /><span>{title}</span><span className="window-move-hint">Drag to move</span></button>
      <div className="floating-actions">
        <button type="button" aria-label={`${minimized ? 'Restore' : 'Minimize'} ${label}`}
          title={minimized ? 'Restore window' : 'Minimize window'}
          onClick={() => {
            if (maximized) setMaximized(false);
            setMinimized(!minimized); onMinimizeChange?.(!minimized);
          }}><Icon name={minimized ? 'restore' : 'minimize'} size={16} /></button>
        <button type="button" aria-label={`${maximized ? 'Restore size of' : 'Maximize'} ${label}`}
          title={maximized ? 'Restore window size' : 'Maximize window'} onClick={toggleMaximize}>
          <Icon name={maximized ? 'restore' : 'maximize'} size={16} /></button>
        {onExpand && <button type="button" aria-label={`Expand ${label}`} title="Open full chat"
          onClick={onExpand}><Icon name="expand" size={16} /></button>}
        {onClose && <button type="button" aria-label={`Close ${label}`} title={label === 'video call' ? 'Leave call' : 'Close chat'}
          onClick={onClose}><Icon name="close" size={16} /></button>}
      </div>
    </header>}
    <div className="floating-content">{children}</div>
    {enabled && !minimized && !maximized && <button type="button" className="window-resize-handle"
      aria-label={`Resize ${label} window`} title="Drag to resize. Arrow keys resize; Shift for larger steps."
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = ref.current.getBoundingClientRect();
        drag.current = { id: event.pointerId, resize: true, x: event.clientX, y: event.clientY,
          width: rect.width, height: rect.height };
        pending.current = null;
        ref.current.setAttribute('data-resizing', 'true');
      }} onPointerMove={(event) => {
        const start = drag.current;
        if (!start?.resize || start.id !== event.pointerId) return;
        pending.current = { width: start.width + event.clientX - start.x, height: start.height + event.clientY - start.y };
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          if (pending.current) resize(pending.current.width, pending.current.height);
        });
      }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onKeyDown={(event) => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!directions[event.key]) return;
        event.preventDefault();
        const [x, y] = directions[event.key];
        const step = event.shiftKey ? 40 : 12;
        resize(ref.current.offsetWidth + x * step, ref.current.offsetHeight + y * step);
      }}><Icon name="resize" size={14} /></button>}
  </div>;
}

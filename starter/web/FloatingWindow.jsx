import React, { useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';

let frontLayer = 40;

export default function FloatingWindow({ enabled = true, title, label, testId, className = '',
  corner = 'bottom-right', collapseContent = true, onExpand, onClose, children }) {
  const ref = useRef(null);
  const position = useRef(null);
  const drag = useRef(null);
  const frame = useRef(null);
  const pending = useRef(null);
  const [minimized, setMinimized] = useState(false);

  function place(x, y) {
    const area = ref.current;
    if (!area) return;
    const width = window.visualViewport?.width ?? window.innerWidth;
    const height = window.visualViewport?.height ?? window.innerHeight;
    position.current = {
      x: Math.max(12, Math.min(x, width - area.offsetWidth - 12)),
      y: Math.max(12, Math.min(y, height - area.offsetHeight - 12)),
    };
    area.style.left = `${position.current.x}px`;
    area.style.top = `${position.current.y}px`;
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
    if (!enabled) return;
    if (position.current) place(position.current.x, position.current.y);
    else reset();
    const fit = () => { if (position.current) place(position.current.x, position.current.y); };
    const observer = new ResizeObserver(fit);
    observer.observe(ref.current);
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
      cancelAnimationFrame(frame.current);
      drag.current = null;
    };
  }, [enabled]);

  function finish(event) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    cancelAnimationFrame(frame.current);
    if (pending.current) place(pending.current.x, pending.current.y);
    pending.current = null;
    drag.current = null;
    ref.current?.removeAttribute('data-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div ref={ref} className={`${enabled ? 'floating-window' : 'inline-window'} ${className}
    ${minimized && enabled ? 'is-minimized' : ''} ${collapseContent ? 'collapse-content' : ''}`}
    data-testid={testId} onPointerDownCapture={() => {
      if (enabled) ref.current.style.zIndex = String(++frontLayer);
    }} onFocusCapture={() => { if (enabled) ref.current.style.zIndex = String(++frontLayer); }}>
    {enabled && <header className="floating-titlebar">
      <button type="button" className="window-drag-handle" aria-label={`Move ${label} window`}
        title="Drag to move. Arrow keys move; Home resets the position."
        onDoubleClick={reset} onPointerDown={(event) => {
          if (event.button !== 0) return;
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
          onClick={() => setMinimized((value) => !value)}><Icon name={minimized ? 'expand' : 'minimize'} size={16} /></button>
        {onExpand && <button type="button" aria-label={`Expand ${label}`} title="Open full chat"
          onClick={onExpand}><Icon name="expand" size={16} /></button>}
        {onClose && <button type="button" aria-label={`Close ${label}`} title={label === 'video call' ? 'Leave call' : 'Close chat'}
          onClick={onClose}><Icon name="close" size={16} /></button>}
      </div>
    </header>}
    <div className="floating-content">{children}</div>
  </div>;
}

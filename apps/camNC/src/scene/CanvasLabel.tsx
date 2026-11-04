import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useRef, type ComponentProps, type ReactNode } from 'react';
import { Vector3 } from 'three';

type HtmlProps = ComponentProps<typeof Html>;
const kPadding = 8;

/** A world-anchored label kept inside the canvas, including when a dock narrows the view. */
export function CanvasLabel({
  position,
  offset = [12, -10],
  maxWidth = 256,
  interactive = false,
  zIndexRange = [10, 0],
  children,
}: {
  position: [number, number, number];
  offset?: [number, number];
  maxWidth?: number;
  interactive?: boolean;
  zIndexRange?: [number, number];
  children: ReactNode;
}) {
  const size = useThree(s => s.size);
  const content = useRef<HTMLDivElement>(null);
  const projected = useRef(new Vector3());
  const [dx, dy] = offset;
  const calculatePosition = useCallback<NonNullable<HtmlProps['calculatePosition']>>(
    (object, camera, viewport) => {
      const p = projected.current.setFromMatrixPosition(object.matrixWorld).project(camera);
      const x = ((p.x + 1) * viewport.width) / 2 + dx;
      const y = ((1 - p.y) * viewport.height) / 2 + dy;
      const width = content.current?.offsetWidth ?? 0;
      const height = content.current?.offsetHeight ?? 0;
      return [
        Math.max(kPadding, Math.min(x, viewport.width - width - kPadding)),
        Math.max(kPadding, Math.min(y, viewport.height - height - kPadding)),
      ];
    },
    [dx, dy]
  );
  return (
    <Html
      position={position}
      calculatePosition={calculatePosition}
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
      zIndexRange={zIndexRange}>
      <div
        ref={content}
        style={{
          width: 'max-content',
          maxWidth: Math.max(1, Math.min(maxWidth, size.width - 2 * kPadding)),
          maxHeight: Math.max(1, size.height - 2 * kPadding),
          overflow: 'auto',
          overflowWrap: 'anywhere',
        }}>
        {children}
      </div>
    </Html>
  );
}

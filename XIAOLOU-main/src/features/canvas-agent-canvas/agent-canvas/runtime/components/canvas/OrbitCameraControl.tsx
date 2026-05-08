/**
 * OrbitCameraControl — 多角度 3D 预览
 * 设计参考 Lovart Multi-Angles (https://github.com/harryluo163/Lovart-Multi-Angles)
 *
 * 主体模式：圆角立方体（前面贴图 + 其余面方位标签）居中可拖动旋转
 * 摄像头模式：立方体后移，球面经纬网格可见，摄像机模型绕球面轨道可拖动
 * 整个预览区按住拖动 = 调整 rotation / tilt；滚轮 = 缩放
 */

import React, {
    Suspense,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

// ================================================================
// Constants
// ================================================================

export const ANGLE_ROTATION_MIN = -90;
export const ANGLE_ROTATION_MAX = 90;
export const ANGLE_TILT_MIN = -30;
export const ANGLE_TILT_MAX = 60;

const CUBE_SIZE = 1.3;
const CUBE_HALF = CUBE_SIZE / 2;
const SPHERE_GRID_RADIUS = 1.3;
const CAMERA_ORBIT_RADIUS = 1.2;
const CUBE_Z_IN_CAMERA_MODE = -1.8;

const DRAG_SENSITIVITY = 1;
const ZOOM_PER_WHEEL_UNIT = 1;

interface OrbitCameraControlProps {
    imageUrl: string;
    mode?: 'subject' | 'camera';
    rotation: number;
    tilt: number;
    zoom: number;
    onRotationChange: (value: number) => void;
    onTiltChange: (value: number) => void;
    onZoomChange: (value: number) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function zoomToCubeScale(zoom: number) {
    if (zoom <= 0) return 0.9;
    if (zoom <= 50) return 0.9 + (zoom / 50) * 0.25;
    return 1.15 + ((zoom - 50) / 50) * 0.35;
}

// ================================================================
// Helpers — canvas-based text texture for cube face labels
// ================================================================

function makeTextCanvas(text: string, size = 256): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(245,245,245,0.1)';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.font = `bold ${Math.round(size * 0.5)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2);
    return canvas;
}

const FACE_LABELS = ['R', 'L', 'T', 'B', 'F', 'K'] as const;

function useFaceLabelTextures() {
    return useMemo(() => {
        return FACE_LABELS.map((label) => {
            const tex = new THREE.CanvasTexture(makeTextCanvas(label));
            tex.colorSpace = THREE.SRGBColorSpace;
            return tex;
        });
    }, []);
}

// ================================================================
// Hook: load image as CanvasTexture (cropped to square, centered)
// ================================================================

function useSquareImageTexture(imageUrl: string) {
    const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

    useEffect(() => {
        if (!imageUrl) {
            setTexture(null);
            return;
        }
        let cancelled = false;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            if (cancelled) return;
            const size = 512;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d')!;
            const aspect = img.width / img.height;
            const drawW = size;
            const drawH = size / aspect;
            ctx.drawImage(img, 0, (size - drawH) / 2, drawW, drawH);
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            setTexture(tex);
        };
        img.onerror = () => {
            if (!cancelled) setTexture(null);
        };
        img.src = imageUrl;
        return () => {
            cancelled = true;
        };
    }, [imageUrl]);

    return texture;
}

function useRawImageTexture(imageUrl: string) {
    const [texture, setTexture] = useState<THREE.Texture | null>(null);
    useEffect(() => {
        if (!imageUrl) { setTexture(null); return; }
        let cancelled = false;
        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous';
        loader.load(
            imageUrl,
            (tex) => {
                if (cancelled) { tex.dispose(); return; }
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.wrapS = THREE.ClampToEdgeWrapping;
                tex.wrapT = THREE.ClampToEdgeWrapping;
                setTexture(tex);
            },
            undefined,
            () => { if (!cancelled) setTexture(null); },
        );
        return () => { cancelled = true; };
    }, [imageUrl]);
    return texture;
}

// ================================================================
// Scene camera positioning
// ================================================================

function SceneCamera({ mode }: { mode: 'subject' | 'camera' }) {
    const { camera } = useThree();
    useLayoutEffect(() => {
        camera.position.set(0, 0, 5);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, mode === 'camera' ? CUBE_Z_IN_CAMERA_MODE * 0.3 : 0);
        camera.updateProjectionMatrix();
    }, [camera, mode]);
    return null;
}

// ================================================================
// Lovart-style rounded cube with face labels + image on front
// ================================================================

interface LovartCubeProps {
    imageUrl: string;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: number;
    showLabels?: boolean;
}

const FACE_PLANE_SIZE = CUBE_SIZE * 0.88;
const FACE_OFFSET = CUBE_HALF + 0.002;

const FACE_CONFIGS: { pos: [number, number, number]; rot: [number, number, number]; labelIdx: number }[] = [
    { pos: [FACE_OFFSET, 0, 0], rot: [0, Math.PI / 2, 0], labelIdx: 0 },       // +X  R
    { pos: [-FACE_OFFSET, 0, 0], rot: [0, -Math.PI / 2, 0], labelIdx: 1 },      // -X  L
    { pos: [0, FACE_OFFSET, 0], rot: [-Math.PI / 2, 0, 0], labelIdx: 2 },       // +Y  T
    { pos: [0, -FACE_OFFSET, 0], rot: [Math.PI / 2, 0, 0], labelIdx: 3 },       // -Y  B
    { pos: [0, 0, FACE_OFFSET], rot: [0, 0, 0], labelIdx: 4 },                  // +Z  F (front — image)
    { pos: [0, 0, -FACE_OFFSET], rot: [0, Math.PI, 0], labelIdx: 5 },           // -Z  K
];

function LovartCube({ imageUrl, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, showLabels = true }: LovartCubeProps) {
    const labelTextures = useFaceLabelTextures();
    const frontTexture = useSquareImageTexture(imageUrl);

    return (
        <group position={position} rotation={rotation} scale={scale}>
            <RoundedBox args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} radius={0.1} smoothness={1}>
                <meshPhongMaterial color="#e8e8e8" />
            </RoundedBox>

            {showLabels && FACE_CONFIGS.map((face, i) => {
                const isFront = face.labelIdx === 4;
                const tex = isFront ? frontTexture : labelTextures[face.labelIdx];
                if (!tex && isFront) return null;
                return (
                    <mesh key={i} position={face.pos} rotation={face.rot}>
                        <planeGeometry args={isFront ? [CUBE_SIZE * 0.92, CUBE_SIZE * 0.92] : [FACE_PLANE_SIZE, FACE_PLANE_SIZE]} />
                        <meshBasicMaterial
                            map={tex}
                            transparent
                            opacity={isFront ? 1 : 0.9}
                            depthWrite={false}
                            side={THREE.FrontSide}
                        />
                    </mesh>
                );
            })}
        </group>
    );
}

// ================================================================
// Sphere grid (latitude / longitude lines, vertex dots, arcs)
// ================================================================

function SphereGrid({ visible }: { visible: boolean }) {
    const groupRef = useRef<THREE.Group>(null);

    useEffect(() => {
        const group = groupRef.current;
        if (!group) return;
        const r = SPHERE_GRID_RADIUS;

        const makeLine = (points: THREE.Vector3[], opacity: number) => {
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity });
            const line = new THREE.Line(geo, mat);
            group.add(line);
        };

        // Latitude lines (every 18°)
        for (let lat = -90; lat <= 90; lat += 18) {
            const phi = (90 - lat) * (Math.PI / 180);
            const lr = r * Math.sin(phi);
            const y = r * Math.cos(phi);
            const isKey = lat % 45 === 0;
            const pts: THREE.Vector3[] = [];
            for (let i = 0; i <= 64; i++) {
                const a = (i / 64) * Math.PI * 2;
                pts.push(new THREE.Vector3(lr * Math.cos(a), y, lr * Math.sin(a)));
            }
            makeLine(pts, isKey ? 0.3 : 0.15);
        }

        // Longitude lines (every 9°)
        for (let lon = -90; lon <= 90; lon += 9) {
            const theta = lon * (Math.PI / 180);
            const isKey = lon % 45 === 0;
            const pts: THREE.Vector3[] = [];
            for (let i = 0; i <= 64; i++) {
                const a = (i / 64) * Math.PI * 2;
                pts.push(new THREE.Vector3(r * Math.sin(a) * Math.cos(theta), r * Math.cos(a), r * Math.sin(a) * Math.sin(theta)));
            }
            makeLine(pts, isKey ? 0.3 : 0.15);
        }

        // 4 cardinal vertex dots
        const dotGeo = new THREE.SphereGeometry(0.03, 16, 16);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0x999999 });
        const verts: [number, number, number][] = [[0, r, 0], [0, -r, 0], [r, 0, 0], [-r, 0, 0]];
        for (const v of verts) {
            const dot = new THREE.Mesh(dotGeo, dotMat);
            dot.position.set(...v);
            group.add(dot);
        }

        // Great-circle arcs connecting each pair of vertices
        const slerp = (a: THREE.Vector3, b: THREE.Vector3, segs = 30) => {
            const p1 = a.clone().normalize().multiplyScalar(r);
            const p2 = b.clone().normalize().multiplyScalar(r);
            const pts: THREE.Vector3[] = [];
            const angle = Math.acos(clamp(p1.dot(p2) / (r * r), -1, 1));
            const sinA = Math.sin(angle);
            for (let i = 0; i <= segs; i++) {
                const t = i / segs;
                if (sinA < 0.001) {
                    pts.push(p1.clone().lerp(p2, t));
                } else {
                    const w1 = Math.sin((1 - t) * angle) / sinA;
                    const w2 = Math.sin(t * angle) / sinA;
                    pts.push(p1.clone().multiplyScalar(w1).add(p2.clone().multiplyScalar(w2)));
                }
            }
            return pts;
        };

        const vertVecs = verts.map(v => new THREE.Vector3(...v));
        for (let i = 0; i < vertVecs.length; i++) {
            for (let j = i + 1; j < vertVecs.length; j++) {
                makeLine(slerp(vertVecs[i], vertVecs[j]), 0.3);
            }
        }

        return () => {
            group.traverse((obj) => {
                if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
                const mat = (obj as THREE.Mesh).material;
                if (mat) {
                    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
                    else (mat as THREE.Material).dispose();
                }
            });
            while (group.children.length) group.remove(group.children[0]);
        };
    }, []);

    return <group ref={groupRef} visible={visible} />;
}

// ================================================================
// Camera model (body + front/back screens + top button)
// ================================================================

function CameraModel({
    imageUrl,
    sphereX,
    sphereY,
}: {
    imageUrl: string;
    sphereX: number;
    sphereY: number;
}) {
    const tex = useRawImageTexture(imageUrl);
    const theta = THREE.MathUtils.degToRad(-sphereY);
    const phi = THREE.MathUtils.degToRad(-sphereX);
    const r = CAMERA_ORBIT_RADIUS;

    const pos = useMemo<[number, number, number]>(
        () => [
            r * Math.cos(phi) * Math.sin(theta),
            r * Math.sin(phi),
            r * Math.cos(phi) * Math.cos(theta),
        ],
        [phi, r, theta],
    );

    const groupRef = useRef<THREE.Group>(null);
    useLayoutEffect(() => {
        groupRef.current?.lookAt(0, 0, 0);
    }, [pos]);

    return (
        <group ref={groupRef} position={pos}>
            {/* body */}
            <RoundedBox args={[0.4, 0.28, 0.15]} radius={0.04} smoothness={2}>
                <meshPhongMaterial color="#ffffff" specular={0xffffff} shininess={100} side={THREE.DoubleSide} />
            </RoundedBox>
            {/* front screen (faces center) */}
            <mesh position={[0, 0, -0.08]} renderOrder={1100}>
                <planeGeometry args={[0.24, 0.17]} />
                {tex ? <meshBasicMaterial map={tex} side={THREE.DoubleSide} /> : <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />}
            </mesh>
            {/* back screen (faces viewer) */}
            <mesh position={[0, 0, 0.08]} renderOrder={1100}>
                <planeGeometry args={[0.3, 0.2]} />
                {tex ? <meshBasicMaterial map={tex} side={THREE.DoubleSide} /> : <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />}
            </mesh>
            {/* top button */}
            <mesh position={[-0.14, 0.14, 0]} rotation={[0, 0, 0]}>
                <cylinderGeometry args={[0.035, 0.035, 0.008, 32]} />
                <meshPhongMaterial color="#202020" />
            </mesh>
        </group>
    );
}

// ================================================================
// Connection line (cylinder from origin to camera position)
// ================================================================

function ConnectionLine({ sphereX, sphereY, visible }: { sphereX: number; sphereY: number; visible: boolean }) {
    const theta = THREE.MathUtils.degToRad(-sphereY);
    const phi = THREE.MathUtils.degToRad(-sphereX);
    const r = CAMERA_ORBIT_RADIUS;

    const target = useMemo<THREE.Vector3>(
        () => new THREE.Vector3(
            r * Math.cos(phi) * Math.sin(theta),
            r * Math.sin(phi),
            r * Math.cos(phi) * Math.cos(theta),
        ),
        [phi, r, theta],
    );

    const midpoint = useMemo(() => target.clone().multiplyScalar(0.5), [target]);
    const length = useMemo(() => target.length(), [target]);

    const quat = useMemo(() => {
        const dir = target.clone().normalize();
        return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }, [target]);

    if (!visible) return null;

    return (
        <mesh position={midpoint} quaternion={quat} renderOrder={1000}>
            <cylinderGeometry args={[0.005, 0.005, length, 8]} />
            <meshBasicMaterial color="#888888" depthTest={false} depthWrite={false} />
        </mesh>
    );
}

// ================================================================
// Subject mode scene
// ================================================================

function SubjectScene({ imageUrl, rotation, tilt, zoom }: {
    imageUrl: string; rotation: number; tilt: number; zoom: number;
}) {
    const rotY = THREE.MathUtils.degToRad(rotation);
    const rotX = THREE.MathUtils.degToRad(tilt);
    const scale = zoomToCubeScale(zoom);

    return (
        <>
            <SceneCamera mode="subject" />
            <ambientLight intensity={1.5} />
            <directionalLight position={[3, 5, 3]} intensity={1.5} />
            <directionalLight position={[-3, -2, -5]} intensity={0.8} />

            <SphereGrid visible={false} />

            <LovartCube
                imageUrl={imageUrl}
                rotation={[rotX, rotY, 0]}
                scale={scale}
            />
        </>
    );
}

// ================================================================
// Camera mode scene
// ================================================================

function CameraScene({ imageUrl, rotation, tilt, zoom }: {
    imageUrl: string; rotation: number; tilt: number; zoom: number;
}) {
    const scale = zoomToCubeScale(zoom);

    return (
        <>
            <SceneCamera mode="camera" />
            <ambientLight intensity={1.5} />
            <directionalLight position={[3, 5, 3]} intensity={1.5} />
            <directionalLight position={[-3, -2, -5]} intensity={0.8} />

            <SphereGrid visible />

            <LovartCube
                imageUrl={imageUrl}
                position={[0, 0, CUBE_Z_IN_CAMERA_MODE]}
                scale={scale}
                showLabels={false}
            />

            <CameraModel imageUrl={imageUrl} sphereX={tilt} sphereY={rotation} />
            <ConnectionLine sphereX={tilt} sphereY={rotation} visible />
        </>
    );
}

// ================================================================
// Main component
// ================================================================

export const OrbitCameraControl: React.FC<OrbitCameraControlProps> = ({
    imageUrl,
    mode = 'camera',
    rotation,
    tilt,
    zoom,
    onRotationChange,
    onTiltChange,
    onZoomChange,
}) => {
    const rotationRef = useRef(rotation);
    const tiltRef = useRef(tilt);
    const zoomRef = useRef(zoom);
    const dragRef = useRef<{ active: boolean; lastX: number; lastY: number } | null>(null);
    const accumX = useRef(0);
    const accumY = useRef(0);
    const DRAG_THRESHOLD = 3;

    useEffect(() => { rotationRef.current = rotation; }, [rotation]);
    useEffect(() => { tiltRef.current = tilt; }, [tilt]);
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);

    const applyDelta = useCallback((dx: number, dy: number) => {
        accumX.current += dx;
        accumY.current += dy;

        if (Math.abs(accumX.current) < DRAG_THRESHOLD && Math.abs(accumY.current) < DRAG_THRESHOLD) return;

        if (Math.abs(accumX.current) >= DRAG_THRESHOLD) {
            const next = clamp(
                rotationRef.current + accumX.current * DRAG_SENSITIVITY,
                ANGLE_ROTATION_MIN,
                ANGLE_ROTATION_MAX,
            );
            rotationRef.current = next;
            onRotationChange(next);
            accumX.current = 0;
        }
        if (Math.abs(accumY.current) >= DRAG_THRESHOLD) {
            const next = clamp(
                tiltRef.current + accumY.current * DRAG_SENSITIVITY,
                ANGLE_TILT_MIN,
                ANGLE_TILT_MAX,
            );
            tiltRef.current = next;
            onTiltChange(next);
            accumY.current = 0;
        }
    }, [onRotationChange, onTiltChange]);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        rotationRef.current = rotation;
        tiltRef.current = tilt;
        accumX.current = 0;
        accumY.current = 0;
        dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    }, [rotation, tilt]);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag?.active) return;
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        applyDelta(dx, dy);
    }, [applyDelta]);

    const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current?.active) return;
        dragRef.current = null;
        accumX.current = 0;
        accumY.current = 0;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* */ }
    }, []);

    const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (e.deltaY === 0) return;
        const step = ZOOM_PER_WHEEL_UNIT * 8;
        const next = clamp(zoomRef.current + (e.deltaY > 0 ? step : -step), 0, 100);
        zoomRef.current = next;
        onZoomChange(next);
    }, [onZoomChange]);

    return (
        <div
            role="application"
            aria-label="多角度预览"
            className="relative aspect-square w-full overflow-hidden rounded-2xl border border-[#ecebf3] bg-[#fafafa]"
            onWheel={onWheel}
        >
            <Canvas
                className="pointer-events-none !h-full !w-full select-none"
                camera={{ position: [0, 0, 5], fov: 50, near: 0.1, far: 100 }}
                dpr={[1, 1.5]}
                gl={{ antialias: true, alpha: true }}
            >
                <color attach="background" args={['#fafafa']} />
                <Suspense fallback={null}>
                    {mode === 'subject' ? (
                        <SubjectScene imageUrl={imageUrl} rotation={rotation} tilt={tilt} zoom={zoom} />
                    ) : (
                        <CameraScene imageUrl={imageUrl} rotation={rotation} tilt={tilt} zoom={zoom} />
                    )}
                </Suspense>
            </Canvas>

            {/* drag overlay */}
            <div
                className="absolute inset-0 z-[5] cursor-grab touch-none active:cursor-grabbing"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
            />

            <div className="pointer-events-none absolute bottom-1.5 left-2 right-2 z-10 text-center text-[10px] leading-tight text-[#9ca3af]">
                拖动调整角度 · 滚轮缩放
            </div>
        </div>
    );
};

export default OrbitCameraControl;

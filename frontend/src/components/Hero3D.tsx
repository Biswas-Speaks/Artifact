import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useRef, type RefObject } from "react";
import * as THREE from "three";

export interface PlaygroundInput { x: number; y: number; active: boolean; remix: number; paused: boolean }
interface SceneProps { input: RefObject<PlaygroundInput>; colors: string[]; onPop: () => void }

function Shape({ index, input, colors, onPop }: SceneProps & { index: number }) {
  const ref = useRef<THREE.Group>(null);
  const time = useRef(index * .9);
  const bounce = useRef(0);
  const remix = useRef(0);
  const dragging = useRef(false);
  const { viewport } = useThree();
  const mobile = viewport.width < 7;
  const positions = mobile ? [[-.35,.34],[.34,.34],[-.38,-.33],[.36,-.32],[0,.4],[.4,.07]] : [[-.36,.16],[.36,.2],[-.32,-.26],[.34,-.25],[-.15,.34],[.19,.34]];
  const pos = positions[index] ?? [0,0];
  const size = mobile ? .38 : .65;
  useFrame((_, rawDelta) => {
    if (!ref.current) return;
    const dt = Math.min(rawDelta,.05);
    const control = input.current;
    if (control.paused) return;
    time.current += dt;
    if (control.remix !== remix.current) { bounce.current = 1; remix.current = control.remix; }
    bounce.current *= Math.exp(-3 * dt);
    const x = (pos[0] ?? 0) * viewport.width;
    const y = (pos[1] ?? 0) * viewport.height;
    const dx = x - control.x * viewport.width / 2;
    const dy = y - control.y * viewport.height / 2;
    const distance = Math.max(.2, Math.hypot(dx,dy));
    const repel = control.active ? Math.max(0,1-distance/2) * .65 : 0;
    const targetX = dragging.current ? control.x * viewport.width / 2 : x + dx / distance * repel;
    const targetY = dragging.current ? control.y * viewport.height / 2 : y + Math.sin(time.current * .8) * .12 + dy / distance * repel + bounce.current * .5;
    const blend = 1 - Math.exp(-5 * dt);
    ref.current.position.x = THREE.MathUtils.lerp(ref.current.position.x,targetX,blend);
    ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y,targetY,blend);
    ref.current.rotation.x += dt * (.12 + bounce.current * 4);
    ref.current.rotation.y += dt * (.18 + bounce.current * 5);
    ref.current.rotation.z = Math.sin(time.current * .4) * .18;
    ref.current.scale.setScalar(1 + bounce.current * .2);
  });
  const color = colors[index % colors.length];
  if (!color) return null;
  const material = <meshStandardMaterial color={color} roughness={index === 1 ? .24 : .4} metalness={index === 1 ? .22 : .05} />;
  return <group ref={ref} position={[(pos[0] ?? 0)*viewport.width,(pos[1] ?? 0)*viewport.height,0]} rotation={[.3,.3,.1]} onPointerDown={(e) => { e.stopPropagation(); dragging.current=true; bounce.current=1; onPop(); const target=e.target as Element; if ('setPointerCapture' in target) target.setPointerCapture(e.pointerId); }} onPointerUp={(e) => { dragging.current=false; const target=e.target as Element; if ('releasePointerCapture' in target) target.releasePointerCapture(e.pointerId); }} onPointerOver={() => { bounce.current=.3; }}>
    {index === 0 || index === 3 ? <mesh><torusGeometry args={[size,size*.32,16,48]} />{material}</mesh> : index === 1 ? <RoundedBox args={[size*1.6,size*1.6,size*1.6]} radius={.12} smoothness={3}>{material}</RoundedBox> : index === 2 ? <mesh><icosahedronGeometry args={[size*1.15,0]} />{material}</mesh> : index === 4 ? <mesh><octahedronGeometry args={[size*.55,0]} />{material}</mesh> : <mesh><coneGeometry args={[size*.55,size*1.3,3]} />{material}</mesh>}
  </group>;
}

export default function Hero3D(props: SceneProps) {
  return <div className="absolute inset-0" aria-label="Interactive geometric sculpture garden"><Canvas camera={{ position:[0,0,9], fov:45 }} dpr={[1,1.5]} gl={{ antialias:true, alpha:true }}><ambientLight intensity={1.2} /><directionalLight position={[-4,6,8]} intensity={2.2} /><Suspense fallback={null}><Environment resolution={64}><Lightformer intensity={3} position={[0,5,4]} scale={[10,10,1]} /><Lightformer intensity={1.5} position={[-5,1,2]} rotation-y={Math.PI/2} scale={[10,4,1]} /></Environment></Suspense>{Array.from({length:6},(_,index)=><Shape key={index} index={index} {...props} />)}</Canvas></div>;
}

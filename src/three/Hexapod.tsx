import { useMemo } from "react";
import { DoubleSide, Shape } from "three";
import { computeLegMounts } from "../model/hexapod";
import { useHexapodStore } from "../store/useHexapodStore";
import { useBodyTransform } from "../store/useBodyTransform";
import { useCollisions } from "../store/useCollisions";
import { ContactMarkers } from "./ContactMarkers";
import { CollisionMarker } from "./CollisionMarker";
import { Leg } from "./Leg";

const ARROW_COLOR = "#1a1a1a";

function makeArrowShape(
  totalLen: number,
  shaftLen: number,
  shaftWidth: number,
  headWidth: number
): Shape {
  const xStart = -totalLen / 2;
  const xShaftEnd = xStart + shaftLen;
  const xTip = totalLen / 2;
  const sw = shaftWidth / 2;
  const hw = headWidth / 2;

  const s = new Shape();
  s.moveTo(xStart, +sw);
  s.lineTo(xShaftEnd, +sw);
  s.lineTo(xShaftEnd, +hw);
  s.lineTo(xTip, 0);
  s.lineTo(xShaftEnd, -hw);
  s.lineTo(xShaftEnd, -sw);
  s.lineTo(xStart, -sw);
  s.lineTo(xStart, +sw);
  return s;
}

interface ArrowProps {
  chassisLength: number;
  chassisHeight: number;
  flipDown: boolean;
}

function FrontArrow({ chassisLength, chassisHeight, flipDown }: ArrowProps) {
  const totalLen = chassisLength * 0.5;
  const shaftLen = totalLen * 0.65;
  const shape = useMemo(
    () => makeArrowShape(totalLen, shaftLen, 0.014, 0.04),
    [totalLen, shaftLen]
  );

  const y = flipDown ? -chassisHeight / 2 - 0.001 : chassisHeight / 2 + 0.001;
  const rotX = flipDown ? -Math.PI / 2 : Math.PI / 2;

  return (
    <mesh position={[0, y, 0]} rotation={[rotX, 0, 0]}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color={ARROW_COLOR} side={DoubleSide} />
    </mesh>
  );
}

export function Hexapod() {
  const geometry = useHexapodStore((s) => s.geometry);
  const gravityEnabled = useHexapodStore((s) => s.gravityEnabled);
  const bodyTransparent = useHexapodStore((s) => s.bodyTransparent);
  const showArrow = useHexapodStore((s) => s.collisionPrefs.showArrow);
  const mounts = useMemo(() => computeLegMounts(geometry), [geometry]);
  const transform = useBodyTransform();
  const collisions = useCollisions();

  // Pour chaque patte, calcule l'ensemble des segments en collision (0/1/2)
  const legCollisionMap = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const key of collisions.collidingSegments) {
      const [legStr, segStr] = key.split("-");
      const legIndex = parseInt(legStr, 10);
      const seg = parseInt(segStr, 10);
      if (!map.has(legIndex)) map.set(legIndex, new Set());
      map.get(legIndex)!.add(seg);
    }
    return map;
  }, [collisions.collidingSegments]);

  return (
    <>
      <group
        position={[transform.position.x, transform.position.y, transform.position.z]}
        quaternion={[
          transform.quaternion.x,
          transform.quaternion.y,
          transform.quaternion.z,
          transform.quaternion.w,
        ]}
      >
        {/* Chassis */}
        <mesh castShadow receiveShadow>
          <boxGeometry
            args={[geometry.chassis.length, geometry.chassis.height, geometry.chassis.width]}
          />
          <meshStandardMaterial
            color="#f5c518"
            metalness={0.2}
            roughness={0.5}
            transparent={bodyTransparent}
            opacity={bodyTransparent ? 0.45 : 1}
          />
        </mesh>

        {/* Front face marker */}
        <mesh position={[geometry.chassis.length / 2 + 0.001, 0, 0]}>
          <boxGeometry
            args={[0.004, geometry.chassis.height * 0.6, geometry.chassis.width * 0.6]}
          />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>

        {/* Front orientation arrows — flat decals on top and bottom faces */}
        <FrontArrow
          chassisLength={geometry.chassis.length}
          chassisHeight={geometry.chassis.height}
          flipDown={false}
        />
        <FrontArrow
          chassisLength={geometry.chassis.length}
          chassisHeight={geometry.chassis.height}
          flipDown={true}
        />

        {/* Center of gravity marker — red sphere in chassis body frame */}
        <mesh position={[geometry.cog.x, geometry.cog.y, geometry.cog.z]}>
          <sphereGeometry args={[0.012, 16, 12]} />
          <meshStandardMaterial color="#dc2626" emissive="#7f1d1d" emissiveIntensity={0.4} />
        </mesh>

        {mounts.map((m) => (
          <Leg key={m.index} mount={m} collidingSegs={legCollisionMap.get(m.index)} />
        ))}

        {/* Flèche 3D de marquage de collision */}
        {collisions.hasCollision && showArrow && collisions.center && (
          <CollisionMarker center={collisions.center} />
        )}
      </group>

      {gravityEnabled && (
        <ContactMarkers
          contacts={transform.contacts}
          cogWorld={transform.cogWorld}
          supportPolygon={transform.supportPolygon}
          cogInside={transform.cogInside}
        />
      )}
    </>
  );
}

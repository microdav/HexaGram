import { useEffect, useMemo } from "react";
import { DoubleSide, Shape, Vector3 } from "three";
import { computeLegMounts, segmentWidthsOf, segmentHeightsOf, type HexapodGeometry, type LegMount } from "../model/hexapod";
import { findServoType } from "../model/servoTypes";
import { useProjectStore } from "../store/useProjectStore";
import { makeTaperedBox } from "./legGeometry";
import { buildChassisGeometry } from "../model/chassisShape";
import { computeBodyTransform } from "../model/kinematics";
import { degToRad } from "../model/servo";
import { servoIndex, type Pose } from "../model/pose";

const ARROW_COLOR = "#1a1a1a";
const CHASSIS_COLOR = "#f5c518";
const SEGMENT_COLOR = "#f5c518";
const JOINT_COLOR = "#222";
const FOOT_COLOR = "#888";

function makeArrowShape(totalLen: number, shaftLen: number, shaftWidth: number, headWidth: number): Shape {
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

interface MiniLegProps {
  mount: LegMount;
  pose: Pose;
  geometry: HexapodGeometry;
}

function MiniLeg({ mount, pose, geometry }: MiniLegProps) {
  const segs = geometry.segments;
  const segW = segmentWidthsOf(geometry, mount.index);
  // Hauteurs Y (vue de face) — reflète les dimensions des pattes dans les vignettes.
  const hw = useProjectStore.getState().activeProject?.hardware;
  const spec = findServoType(hw?.servoTypeId, hw?.customServoTypes ?? []);
  const servoHm = (spec?.dimensionsMm.h ?? 38) / 1000;
  const servoWm = (spec?.dimensionsMm.w ?? 20) / 1000;
  const sh = segmentHeightsOf(geometry, mount.index);
  const coxaY = Math.min(geometry.chassis.height, Math.max(servoHm, sh.coxa));
  const femurY = sh.femur;
  const tibiaKnee = geometry.segmentHeights?.[mount.index]?.tibia ?? servoWm;
  const tibiaGeo = useMemo(
    () => makeTaperedBox(segs.tibia, segW.tibia, tibiaKnee, sh.tibiaFoot),
    [segs.tibia, segW.tibia, tibiaKnee, sh.tibiaFoot]
  );
  useEffect(() => () => tibiaGeo.dispose(), [tibiaGeo]);
  const coxaDeg = pose[servoIndex(mount.index, "coxa")];
  const femurDeg = pose[servoIndex(mount.index, "femur")];
  const tibiaDeg = pose[servoIndex(mount.index, "tibia")];
  const jointR = 0.012;

  return (
    <group position={mount.position} rotation={[0, degToRad(mount.yawDeg), 0]}>
      <mesh>
        <sphereGeometry args={[jointR, 12, 12]} />
        <meshStandardMaterial color={JOINT_COLOR} />
      </mesh>
      <group rotation={[0, degToRad(coxaDeg), 0]}>
        <mesh position={[segs.coxa / 2, 0, 0]}>
          <boxGeometry args={[segs.coxa, coxaY, segW.coxa]} />
          <meshStandardMaterial color={SEGMENT_COLOR} />
        </mesh>
        <group position={[segs.coxa, 0, 0]}>
          <mesh>
            <sphereGeometry args={[jointR, 12, 12]} />
            <meshStandardMaterial color={JOINT_COLOR} />
          </mesh>
          <group rotation={[0, 0, degToRad(femurDeg)]}>
            <mesh position={[segs.femur / 2, 0, 0]}>
              <boxGeometry args={[segs.femur, femurY, segW.femur]} />
              <meshStandardMaterial color={SEGMENT_COLOR} />
            </mesh>
            <group position={[segs.femur, 0, 0]}>
              <mesh>
                <sphereGeometry args={[jointR, 12, 12]} />
                <meshStandardMaterial color={JOINT_COLOR} />
              </mesh>
              <group rotation={[0, 0, degToRad(tibiaDeg)]}>
                <mesh position={[0, 0, 0]} geometry={tibiaGeo}>
                  <meshStandardMaterial color={SEGMENT_COLOR} />
                </mesh>
                <mesh position={[segs.tibia, 0, 0]}>
                  <sphereGeometry args={[0.012, 10, 10]} />
                  <meshStandardMaterial color={FOOT_COLOR} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

interface MiniHexapodProps {
  pose: Pose;
  geometry: HexapodGeometry;
  gravityEnabled: boolean;
  bodyTransparent: boolean;
}

/**
 * Rendu statique d'un hexapode dans une pose donnée — sans interactivité ni
 * indicateurs (servo arcs, collisions, contacts, couple). Utilisé pour générer
 * les vignettes du séquenceur.
 */
export function MiniHexapod({ pose, geometry, gravityEnabled, bodyTransparent }: MiniHexapodProps) {
  const mounts = useMemo(() => computeLegMounts(geometry), [geometry]);
  const transform = useMemo(
    () => computeBodyTransform(pose, geometry, mounts, gravityEnabled),
    [pose, geometry, mounts, gravityEnabled]
  );
  const arrowShape = useMemo(() => {
    const totalLen = geometry.chassis.length * 0.5;
    return makeArrowShape(totalLen, totalLen * 0.65, 0.014, 0.04);
  }, [geometry.chassis.length]);

  const q: [number, number, number, number] = [
    transform.quaternion.x,
    transform.quaternion.y,
    transform.quaternion.z,
    transform.quaternion.w,
  ];
  const p: [number, number, number] = [
    transform.position.x,
    transform.position.y,
    transform.position.z,
  ];

  const chassisGeos = useMemo(() => {
    const pieces = geometry.body2D?.pieces;
    const h = geometry.chassis.height;
    if (pieces && pieces.length) return pieces.map((pc) => buildChassisGeometry(pc.outer, pc.holes, h));
    const pts = geometry.body2D?.points;
    if (pts && pts.length >= 3) return [buildChassisGeometry(pts, geometry.body2D?.holes, h)];
    return null;
  }, [geometry.body2D?.pieces, geometry.body2D?.points, geometry.body2D?.holes, geometry.chassis.height]);
  useEffect(() => () => chassisGeos?.forEach((g) => g.dispose()), [chassisGeos]);

  return (
    <group position={p} quaternion={q}>
      {chassisGeos ? (
        chassisGeos.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshStandardMaterial color={CHASSIS_COLOR} metalness={0.2} roughness={0.5}
              side={DoubleSide} transparent={bodyTransparent} opacity={bodyTransparent ? 0.45 : 1} />
          </mesh>
        ))
      ) : (
        <mesh>
          <boxGeometry args={[geometry.chassis.length, geometry.chassis.height, geometry.chassis.width]} />
          <meshStandardMaterial color={CHASSIS_COLOR} metalness={0.2} roughness={0.5}
            transparent={bodyTransparent} opacity={bodyTransparent ? 0.45 : 1} />
        </mesh>
      )}
      <mesh position={[geometry.chassis.length / 2 + 0.001, 0, 0]}>
        <boxGeometry args={[0.004, geometry.chassis.height * 0.6, geometry.chassis.width * 0.6]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[0, geometry.chassis.height / 2 + 0.001, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[arrowShape]} />
        <meshBasicMaterial color={ARROW_COLOR} side={DoubleSide} />
      </mesh>
      {mounts.map((m) => (
        <MiniLeg key={m.index} mount={m} pose={pose} geometry={geometry} />
      ))}
    </group>
  );
}

/**
 * Calcule la position de la caméra à partir d'une direction normalisée et d'une
 * distance. La caméra vise (0, 0, 0) avec un léger offset en Y pour cadrer le
 * robot qui repose au sol.
 */
export function computeThumbnailCameraPos(
  cameraDirection: [number, number, number],
  distance: number
): Vector3 {
  const [dx, dy, dz] = cameraDirection;
  const m = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return new Vector3((dx / m) * distance, (dy / m) * distance, (dz / m) * distance);
}


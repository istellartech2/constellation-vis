/**
 * KML geometry renderer for Three.js
 */

import * as THREE from "three";
import * as satellite from "satellite.js";
import type { KMLDocument, KMLGeometry, KMLCoordinate, KMLStyle } from "./kml";

const EARTH_RADIUS_EQUATOR_KM = 6378.137;
const EARTH_RADIUS_POLAR_KM = 6356.7523142;

export class KMLRenderer {
  private scene: THREE.Scene;
  private geometryGroup: THREE.Group;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.geometryGroup = new THREE.Group();
    this.geometryGroup.name = "KMLGeometries";
    this.scene.add(this.geometryGroup);
  }

  /**
   * Update rotation to follow Earth's rotation
   * Should be called from the animation loop with the same rotAngle as earthMesh
   */
  updateRotation(rotAngle: number): void {
    this.geometryGroup.rotation.y = rotAngle;
  }
  
  /**
   * Convert KML coordinate (lat/lon/alt) to Three.js position
   */
  private coordinateToVector3(coord: KMLCoordinate): THREE.Vector3 {
    // Convert to radians
    const lat = coord.latitude * Math.PI / 180;
    const lon = coord.longitude * Math.PI / 180;
    
    // Altitude in km (KML altitudes are in meters)
    const altKm = coord.altitude / 1000;
    
    // Convert to ECF (Earth-Centered Fixed)
    const ecf = satellite.geodeticToEcf({
      longitude: lon,
      latitude: lat,
      height: altKm
    });
    
    // Convert ECF to Three.js coordinates
    // Three.js uses: X (right), Y (up), Z (towards camera)
    // ECF uses: X (Greenwich meridian), Y (90° East), Z (North pole)
    const x = ecf.x / EARTH_RADIUS_EQUATOR_KM;
    const y = ecf.z / EARTH_RADIUS_POLAR_KM;
    const z = -ecf.y / EARTH_RADIUS_EQUATOR_KM;
    
    return new THREE.Vector3(x, y, z);
  }
  
  /**
   * Parse style color to Three.js color
   */
  private parseStyleColor(color?: string): THREE.Color {
    if (!color) return new THREE.Color(0xffffff);
    
    // Remove the # and alpha channel if present
    const hex = color.substring(1, 7);
    return new THREE.Color(`#${hex}`);
  }
  
  /**
   * Render a Point geometry
   */
  private renderPoint(geometry: KMLGeometry, style?: KMLStyle): void {
    const coords = geometry.coordinates as KMLCoordinate[];
    const position = this.coordinateToVector3(coords[0]);
    
    const pointGeometry = new THREE.SphereGeometry(
      style?.pointSize ? style.pointSize / 1000 : 0.01,
      16,
      16
    );
    
    const material = new THREE.MeshBasicMaterial({
      color: style?.pointColor ? this.parseStyleColor(style.pointColor) : 0xffffff
    });
    
    const mesh = new THREE.Mesh(pointGeometry, material);
    mesh.position.copy(position);
    mesh.name = geometry.name || "KMLPoint";
    
    this.geometryGroup.add(mesh);
  }
  
  /**
   * Render a LineString geometry
   */
  private renderLineString(geometry: KMLGeometry, style?: KMLStyle): void {
    const coords = geometry.coordinates as KMLCoordinate[];
    const points = coords.map(coord => this.coordinateToVector3(coord));
    
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    
    const material = new THREE.LineBasicMaterial({
      color: style?.lineColor ? this.parseStyleColor(style.lineColor) : 0xffffff,
      linewidth: style?.lineWidth || 1,
      opacity: style?.lineColor ? parseInt(style.lineColor.substring(7, 9), 16) / 255 : 1,
      transparent: true
    });
    
    const line = new THREE.Line(lineGeometry, material);
    line.name = geometry.name || "KMLLineString";
    
    this.geometryGroup.add(line);
  }
  
  /**
   * Render a Polygon geometry
   */
  private renderPolygon(geometry: KMLGeometry, style?: KMLStyle): void {
    const coordArrays = geometry.coordinates as KMLCoordinate[][];
    
    // Outer boundary
    const outerCoords = coordArrays[0];
    const outerPoints = outerCoords.map(coord => this.coordinateToVector3(coord));
    
    // Create shape for the polygon
    const shape = new THREE.Shape();
    
    // Project to 2D for shape creation (simplified - works best for small polygons)
    // For more complex polygons, a proper spherical triangulation would be needed
    const center = new THREE.Vector3();
    outerPoints.forEach(p => center.add(p));
    center.divideScalar(outerPoints.length);
    
    // Create a local coordinate system
    const up = center.clone().normalize();
    const right = new THREE.Vector3(1, 0, 0);
    if (Math.abs(up.dot(right)) > 0.99) {
      right.set(0, 1, 0);
    }
    const forward = new THREE.Vector3().crossVectors(up, right).normalize();
    right.crossVectors(forward, up).normalize();
    
    // Project points to 2D
    const points2D: THREE.Vector2[] = [];
    outerPoints.forEach((point, i) => {
      const relative = point.clone().sub(center);
      const x = relative.dot(right);
      const y = relative.dot(forward);
      if (i === 0) {
        shape.moveTo(x, y);
      } else {
        shape.lineTo(x, y);
      }
      points2D.push(new THREE.Vector2(x, y));
    });
    shape.closePath();
    
    // Add holes (inner boundaries)
    for (let i = 1; i < coordArrays.length; i++) {
      const hole = new THREE.Path();
      const holeCoords = coordArrays[i];
      const holePoints = holeCoords.map(coord => this.coordinateToVector3(coord));
      
      holePoints.forEach((point, j) => {
        const relative = point.clone().sub(center);
        const x = relative.dot(right);
        const y = relative.dot(forward);
        if (j === 0) {
          hole.moveTo(x, y);
        } else {
          hole.lineTo(x, y);
        }
      });
      hole.closePath();
      shape.holes.push(hole);
    }
    
    // Create geometry from shape
    const shapeGeometry = new THREE.ShapeGeometry(shape);
    
    // Transform back to 3D
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, forward, up);
    matrix.setPosition(center);
    shapeGeometry.applyMatrix4(matrix);
    
    // Create material
    const material = new THREE.MeshBasicMaterial({
      color: style?.polygonColor ? this.parseStyleColor(style.polygonColor) : 0xffffff,
      side: THREE.DoubleSide,
      opacity: style?.polygonColor ? parseInt(style.polygonColor.substring(7, 9), 16) / 255 : 0.5,
      transparent: true
    });
    
    const mesh = new THREE.Mesh(shapeGeometry, material);
    mesh.name = geometry.name || "KMLPolygon";
    
    this.geometryGroup.add(mesh);
    
    // Add outline if style has outline color
    if (style?.polygonOutlineColor) {
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outerPoints);
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: this.parseStyleColor(style.polygonOutlineColor),
        linewidth: 2
      });
      const outline = new THREE.Line(outlineGeometry, outlineMaterial);
      outline.name = (geometry.name || "KMLPolygon") + "_outline";
      this.geometryGroup.add(outline);
    }
  }
  
  /**
   * Render all geometries from a KML document
   */
  renderKMLDocument(kmlDoc: KMLDocument): void {
    // Clear existing KML geometries
    this.clear();
    
    // Render each geometry
    kmlDoc.geometries.forEach(geometry => {
      switch (geometry.type) {
        case 'Point':
          this.renderPoint(geometry, geometry.style);
          break;
        case 'LineString':
          this.renderLineString(geometry, geometry.style);
          break;
        case 'Polygon':
          this.renderPolygon(geometry, geometry.style);
          break;
      }
    });
  }
  
  /**
   * Clear all KML geometries from the scene
   */
  clear(): void {
    // Remove all children from the geometry group
    while (this.geometryGroup.children.length > 0) {
      const child = this.geometryGroup.children[0];
      this.geometryGroup.remove(child);
      
      // Dispose of geometries and materials
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    }
  }
  
  /**
   * Dispose of the renderer and clean up resources
   */
  dispose(): void {
    this.clear();
    this.scene.remove(this.geometryGroup);
  }
}
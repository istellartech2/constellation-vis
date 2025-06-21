/**
 * KML file parser and geometry extractor
 */

export interface KMLStyle {
  id: string;
  lineColor?: string;
  lineWidth?: number;
  pointColor?: string;
  pointSize?: number;
  polygonColor?: string;
  polygonOutlineColor?: string;
}

export interface KMLCoordinate {
  longitude: number;
  latitude: number;
  altitude: number;
}

export interface KMLGeometry {
  type: 'Point' | 'LineString' | 'Polygon';
  coordinates: KMLCoordinate[] | KMLCoordinate[][];
  style?: KMLStyle;
  name?: string;
}

export interface KMLDocument {
  geometries: KMLGeometry[];
  styles: Map<string, KMLStyle>;
}

/**
 * Parse KML color format (aabbggrr) to CSS color (#rrggbbaa)
 */
function parseKMLColor(kmlColor: string): string {
  if (!kmlColor || kmlColor.length !== 8) return '#ffffff';
  
  const a = kmlColor.substring(0, 2);
  const b = kmlColor.substring(2, 4);
  const g = kmlColor.substring(4, 6);
  const r = kmlColor.substring(6, 8);
  
  return `#${r}${g}${b}${a}`;
}

/**
 * Parse coordinates string from KML
 */
function parseCoordinates(coordString: string): KMLCoordinate[] {
  return coordString
    .trim()
    .split(/\s+/)
    .filter(coord => coord.length > 0)
    .map(coord => {
      const [lonStr, latStr, altStr = '0'] = coord.split(',');
      const longitude = parseFloat(lonStr);
      const latitude = parseFloat(latStr);
      const altitude = parseFloat(altStr);
      return { longitude, latitude, altitude };
    });
}

/**
 * Extract styles from KML document
 */
function extractStyles(doc: Document): Map<string, KMLStyle> {
  const styles = new Map<string, KMLStyle>();
  
  const styleElements = doc.querySelectorAll('Style');
  styleElements.forEach(styleEl => {
    const id = styleEl.getAttribute('id') || '';
    const style: KMLStyle = { id };
    
    // LineStyle
    const lineStyle = styleEl.querySelector('LineStyle');
    if (lineStyle) {
      const color = lineStyle.querySelector('color')?.textContent;
      const width = lineStyle.querySelector('width')?.textContent;
      
      if (color) style.lineColor = parseKMLColor(color);
      if (width) style.lineWidth = parseFloat(width);
    }
    
    // IconStyle (for points)
    const iconStyle = styleEl.querySelector('IconStyle');
    if (iconStyle) {
      const color = iconStyle.querySelector('color')?.textContent;
      const scale = iconStyle.querySelector('scale')?.textContent;
      
      if (color) style.pointColor = parseKMLColor(color);
      if (scale) style.pointSize = parseFloat(scale) * 10; // Convert scale to pixel size
    }
    
    // PolyStyle (for polygons)
    const polyStyle = styleEl.querySelector('PolyStyle');
    if (polyStyle) {
      const color = polyStyle.querySelector('color')?.textContent;
      if (color) style.polygonColor = parseKMLColor(color);
    }
    
    styles.set(id, style);
  });
  
  return styles;
}

/**
 * Extract geometries from KML placemarks
 */
function extractGeometries(doc: Document, styles: Map<string, KMLStyle>): KMLGeometry[] {
  const geometries: KMLGeometry[] = [];
  
  const placemarks = doc.querySelectorAll('Placemark');
  placemarks.forEach(placemark => {
    const name = placemark.querySelector('name')?.textContent || undefined;
    const styleUrl = placemark.querySelector('styleUrl')?.textContent;
    const style = styleUrl ? styles.get(styleUrl.substring(1)) : undefined;
    
    // Point
    const point = placemark.querySelector('Point');
    if (point) {
      const coordString = point.querySelector('coordinates')?.textContent;
      if (coordString) {
        const coordinates = parseCoordinates(coordString);
        geometries.push({
          type: 'Point',
          coordinates: coordinates,
          style,
          name
        });
      }
    }
    
    // LineString
    const lineString = placemark.querySelector('LineString');
    if (lineString) {
      const coordString = lineString.querySelector('coordinates')?.textContent;
      if (coordString) {
        const coordinates = parseCoordinates(coordString);
        geometries.push({
          type: 'LineString',
          coordinates: coordinates,
          style,
          name
        });
      }
    }
    
    // Polygon
    const polygon = placemark.querySelector('Polygon');
    if (polygon) {
      const outerBoundary = polygon.querySelector('outerBoundaryIs LinearRing coordinates');
      if (outerBoundary?.textContent) {
        const outerCoords = parseCoordinates(outerBoundary.textContent);
        const coordinates: KMLCoordinate[][] = [outerCoords];
        
        // Inner boundaries (holes)
        const innerBoundaries = polygon.querySelectorAll('innerBoundaryIs LinearRing coordinates');
        innerBoundaries.forEach(inner => {
          if (inner.textContent) {
            coordinates.push(parseCoordinates(inner.textContent));
          }
        });
        
        geometries.push({
          type: 'Polygon',
          coordinates: coordinates,
          style,
          name
        });
      }
    }
  });
  
  return geometries;
}

/**
 * Parse KML file content
 */
export function parseKML(kmlContent: string): KMLDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlContent, 'text/xml');
  
  // Check for parsing errors
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Failed to parse KML: ' + parserError.textContent);
  }
  
  const styles = extractStyles(doc);
  const geometries = extractGeometries(doc, styles);
  
  return {
    geometries,
    styles
  };
}

/**
 * Load and parse KML file from URL
 */
export async function loadKMLFromURL(url: string): Promise<KMLDocument> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load KML file: ${response.statusText}`);
  }
  
  const kmlContent = await response.text();
  return parseKML(kmlContent);
}
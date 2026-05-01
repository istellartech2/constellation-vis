import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { GroundStationDraft } from "../../lib/groundStationSerializer";

// Fix default marker icons not loading under Vite bundler
const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const SelectedIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#f59e0b;border:3px solid #fff;box-shadow:0 0 0 2px #f59e0b;"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const NormalIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#60a5fa;border:2px solid #fff;"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

interface Props {
  stations: GroundStationDraft[];
  selectedId: string | null;
  onMapClick: (lat: number, lng: number) => void;
  onSelect: (id: string) => void;
}

function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      const lat = Math.max(-90, Math.min(90, e.latlng.lat));
      // Normalize longitude to [-180, 180]
      let lng = e.latlng.lng;
      while (lng > 180) lng -= 360;
      while (lng < -180) lng += 360;
      onMapClick(lat, lng);
    },
  });
  return null;
}

function RecenterOnSelect({ lat, lng, id }: { lat: number; lng: number; id: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (id !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
      map.panTo([lat, lng], { animate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return null;
}

export default function GroundStationMap({ stations, selectedId, onMapClick, onSelect }: Props) {
  const selected = stations.find((s) => s.id === selectedId);
  const center: [number, number] = selected
    ? [selected.latitudeDeg, selected.longitudeDeg]
    : [20, 0];

  return (
    <div className="w-full h-full">
      <MapContainer
        center={center}
        zoom={2}
        style={{ height: "100%", width: "100%", background: "#1f2937" }}
        worldCopyJump
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onMapClick={onMapClick} />
        <RecenterOnSelect
          lat={selected?.latitudeDeg ?? 0}
          lng={selected?.longitudeDeg ?? 0}
          id={selectedId}
        />
        {stations.map((s) => (
          <Marker
            key={s.id}
            position={[s.latitudeDeg, s.longitudeDeg]}
            icon={s.id === selectedId ? SelectedIcon : NormalIcon}
            eventHandlers={{ click: () => onSelect(s.id) }}
          />
        ))}
      </MapContainer>
    </div>
  );
}

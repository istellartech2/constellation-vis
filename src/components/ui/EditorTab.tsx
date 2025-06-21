import { useRef } from "react";
import {
  parseSatellitesToml,
  parseConstellationToml,
  parseGroundStationsToml,
} from "../../utils/tomlParse";
import { downloadFile, handleFileLoad } from "../../utils/fileUtils";
import { validateSatellites, validateGroundStations } from "../../utils/validators";
import { Button } from "./button";
import { Textarea } from "./textarea";
import { Download, Upload, Trash2, Globe, Save, FolderOpen } from "lucide-react";

interface Props {
  satText: string;
  constText: string;
  gsText: string;
  startText: string;
  onSatTextChange: (text: string) => void;
  onConstTextChange: (text: string) => void;
  onGsTextChange: (text: string) => void;
  onStartTextChange: (text: string) => void;
  onImportClick: () => void;
  onUpdate: () => void;
  onSaveBundle: () => void;
  onLoadBundle: (file: File) => void;
}

export default function EditorTab({
  satText,
  constText,
  gsText,
  startText,
  onSatTextChange,
  onConstTextChange,
  onGsTextChange,
  onStartTextChange,
  onImportClick,
  onUpdate,
  onSaveBundle,
  onLoadBundle,
}: Props) {
  const satInputRef = useRef<HTMLInputElement | null>(null);
  const constInputRef = useRef<HTMLInputElement | null>(null);
  const gsInputRef = useRef<HTMLInputElement | null>(null);
  const bundleInputRef = useRef<HTMLInputElement | null>(null);


  return (
    <>
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-gray-300">satellites.toml</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={() => downloadFile("satellites.toml", satText)}
              title="Download"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={() => satInputRef.current?.click()}
              title="Load"
            >
              <Upload className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={() => onSatTextChange("")}
              title="Clear"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={onImportClick}
              title="Import"
            >
              <Globe className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Textarea
          value={satText}
          onChange={(e) => onSatTextChange(e.target.value)}
          className="h-16 w-full !text-xs font-mono leading-tight resize-y"
        />
        <input
          ref={satInputRef}
          type="file"
          accept=".toml"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileLoad(f, onSatTextChange, parseSatellitesToml, validateSatellites);
            e.target.value = "";
          }}
        />
      </div>

      <hr className="border-gray-600 my-2" />
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-gray-300">constellation.toml</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={() => downloadFile("constellation.toml", constText)}
              title="Download"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={() => constInputRef.current?.click()}
              title="Load"
            >
              <Upload className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={() => onConstTextChange("")}
              title="Clear"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Textarea
          value={constText}
          onChange={(e) => onConstTextChange(e.target.value)}
          className="h-16 w-full !text-xs font-mono leading-tight resize-y"
        />
        <input
          ref={constInputRef}
          type="file"
          accept=".toml"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileLoad(f, onConstTextChange, parseConstellationToml, validateSatellites);
            e.target.value = "";
          }}
        />
      </div>
      
      <hr className="border-gray-600 my-2" />
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-gray-300">groundstations.toml</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={() => downloadFile("groundstations.toml", gsText)}
              title="Download"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={() => gsInputRef.current?.click()}
              title="Load"
            >
              <Upload className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-2 shadow-md bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white border-gray-500 hover:border-gray-400"
              onClick={() => onGsTextChange("")}
              title="Clear"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Textarea
          value={gsText}
          onChange={(e) => onGsTextChange(e.target.value)}
          className="h-16 w-full !text-xs font-mono leading-tight resize-y"
        />
        <input
          ref={gsInputRef}
          type="file"
          accept=".toml"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileLoad(f, onGsTextChange, parseGroundStationsToml, validateGroundStations);
            e.target.value = "";
          }}
        />
      </div>
      
      <hr className="border-gray-600 my-2" />
      <div className="flex gap-2 mb-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-1 text-xs bg-gray-700 border-2 border-gray-500 text-white hover:bg-gray-600 hover:border-gray-400 font-medium h-7"
          onClick={onSaveBundle}
        >
          <Save className="h-3 w-3" />
          Save All
        </Button>
        <Button 
          variant="outline" 
          size="sm"
          className="flex-1 gap-1 text-xs bg-gray-700 border-2 border-gray-500 text-white hover:bg-gray-600 hover:border-gray-400 font-medium h-7"
          onClick={() => bundleInputRef.current?.click()}
        >
          <FolderOpen className="h-3 w-3" />
          Load All
        </Button>
        <input
          ref={bundleInputRef}
          type="file"
          accept=".toml"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onLoadBundle(f);
            e.target.value = "";
          }}
        />
      </div>
      
      <hr className="border-gray-600 my-2" />
      <div className="mb-2">
        <label className="block text-xs font-medium text-gray-300 mb-1">
          Simulation start (UTC)
        </label>
        <input
          type="datetime-local"
          value={startText}
          onChange={(e) => onStartTextChange(e.target.value)}
          className="w-full text-xs bg-gray-800 border-2 border-gray-500 text-gray-100 rounded px-2 py-1.5 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 outline-none"
        />
      </div>
      
      <hr className="border-gray-600 my-2" />
      <Button
        onClick={onUpdate}
        className="w-full font-medium bg-amber-600 border border-amber-500 hover:bg-amber-700 hover:border-amber-600 text-amber-50 shadow-sm transition-all duration-200 text-sm py-2 h-9 rounded-md"
        size="sm"
      >
        UPDATE
      </Button>
    </>
  );
}
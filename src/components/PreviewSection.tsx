import { useEffect, useState, useRef } from 'react';
import { MatchedPair, ExportFormat } from '../types';
import { blendImages } from '../utils/blender';
import { Image as ImageIcon, Layers, Eye, RefreshCw, ZoomIn, Info, HelpCircle } from 'lucide-react';

interface PreviewSectionProps {
  selectedPair: MatchedPair | null;
  opacity: number;
  format: ExportFormat;
  jpegQuality: number;
  blackThreshold: number;
}

type TabType = 'blended' | 'original' | 'mask';

export default function PreviewSection({
  selectedPair,
  opacity,
  format,
  jpegQuality,
  blackThreshold,
}: PreviewSectionProps) {
  const [activeTab, setActiveTab] = useState<TabType>('blended');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<boolean>(false);

  // Keep track of previous preview URLs to revoke them and prevent memory leaks
  const activeUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedPair) {
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
        activeUrlRef.current = null;
      }
      setPreviewSrc(null);
      setDimensions(null);
      setError(null);
      return;
    }

    let isSubscribed = true;
    setIsLoading(true);
    setError(null);

    async function generatePreview() {
      try {
        const blendedBlob = await blendImages(
          selectedPair.originalFile,
          selectedPair.maskFile,
          opacity,
          format,
          jpegQuality,
          blackThreshold
        );

        if (!isSubscribed) return;

        // Clean up previous URL
        if (activeUrlRef.current) {
          URL.revokeObjectURL(activeUrlRef.current);
        }

        const newUrl = URL.createObjectURL(blendedBlob);
        activeUrlRef.current = newUrl;
        setPreviewSrc(newUrl);

        // Extract dimension info
        const img = new Image();
        img.onload = () => {
          if (isSubscribed) {
            setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          }
        };
        img.src = newUrl;

      } catch (err: any) {
        if (isSubscribed) {
          console.error(err);
          setError(err?.message || 'Failed to render live preview.');
        }
      } finally {
        if (isSubscribed) {
          setIsLoading(false);
        }
      }
    }

    generatePreview();

    return () => {
      isSubscribed = false;
    };
  }, [selectedPair, opacity, format, jpegQuality, blackThreshold]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
      }
    };
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    return (bytes / k).toFixed(1) + ' KB';
  };

  // Safe object URL helpers for drawing separate originals/masks on screen
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPair) {
      setOriginalUrl(null);
      setMaskUrl(null);
      return;
    }
    const oUrl = URL.createObjectURL(selectedPair.originalFile);
    const mUrl = URL.createObjectURL(selectedPair.maskFile);
    setOriginalUrl(oUrl);
    setMaskUrl(mUrl);

    return () => {
      URL.revokeObjectURL(oUrl);
      URL.revokeObjectURL(mUrl);
    };
  }, [selectedPair]);

  if (!selectedPair) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 flex flex-col items-center justify-center text-center h-[380px] shadow-sm">
        <div className="w-14 h-14 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 mb-4">
          <ImageIcon className="w-6 h-6 opacity-80 text-slate-400" />
        </div>
        <h4 className="text-sm font-bold text-slate-800 tracking-tight">Interactive Layer Preview</h4>
        <p className="text-xs text-slate-500 mt-1.5 max-w-xs leading-relaxed">
          Upload and index matching Original Files & CVAT Masks directories above to unlock live real-time composition previewing.
        </p>
      </div>
    );
  }

  const activeSrc = 
    activeTab === 'original' 
      ? originalUrl 
      : activeTab === 'mask' 
      ? maskUrl 
      : previewSrc;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
      {/* Tab controls */}
      <div className="border-b border-slate-100 bg-slate-50/70 p-2.5 px-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 border border-slate-200/50 rounded-lg">
          <button
            onClick={() => setActiveTab('blended')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold tracking-tight transition-all cursor-pointer ${
              activeTab === 'blended'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Blended Overlay
          </button>
          
          <button
            onClick={() => setActiveTab('original')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold tracking-tight transition-all cursor-pointer ${
              activeTab === 'original'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Original Road
          </button>

          <button
            onClick={() => setActiveTab('mask')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold tracking-tight transition-all cursor-pointer ${
              activeTab === 'mask'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            CVAT Color Mask
          </button>
        </div>

        <div className="flex items-center gap-2">
          {dimensions && (
            <span className="font-mono text-[11px] text-slate-500 bg-slate-150/60 p-1 px-2 rounded-md border border-slate-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {dimensions.width} &times; {dimensions.height} px
            </span>
          )}

          <button
            onClick={() => setZoom(!zoom)}
            className={`p-1 rounded-md border transition-all cursor-pointer ${
              zoom ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700'
            }`}
            title="Toggle sizing aspect"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Image Stage (Checkered Transparent Pattern look for transparency testing) */}
      <div className="relative bg-[#1e293b] p-4 flex items-center justify-center min-h-[300px] max-h-[420px] overflow-hidden group" style={{
        backgroundImage: 'radial-gradient(#334155 1px, transparent 1px), radial-gradient(#334155 1px, transparent 1px)',
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 8px 8px'
      }}>
        {isLoading && activeTab === 'blended' && (
          <div className="absolute inset-0 bg-slate-900/85 z-10 flex flex-col items-center justify-center text-slate-300 backdrop-blur-[1px] transition-all">
            <RefreshCw className="w-5.5 h-5.5 animate-spin text-blue-400 mb-2" />
            <span className="text-[10px] font-mono tracking-wider text-slate-400 uppercase">Updating Canvas Buffer...</span>
          </div>
        )}

        {error ? (
          <div className="p-6 text-center text-red-400 max-w-sm">
            <Info className="w-6 h-6 mx-auto text-red-500 mb-2 animate-bounce" />
            <p className="text-xs">{error}</p>
          </div>
        ) : activeSrc ? (
          <div className={`transition-all duration-300 w-full h-full flex items-center justify-center overflow-auto max-h-[380px]`}>
            <img
              src={activeSrc}
              alt="Dataset overlay previews"
              referrerPolicy="no-referrer"
              className={`rounded border border-slate-805 transition-transform duration-200 ${
                zoom ? 'w-full object-contain max-h-[350px]' : 'max-h-[350px] object-scale-down shadow-xl'
              }`}
            />
          </div>
        ) : (
          <div className="text-slate-400 text-xs">Awaiting display buffer...</div>
        )}

        {/* Floating details banner */}
        {activeTab === 'blended' && (
          <div className="absolute bottom-3 left-3 bg-slate-900/95 border border-slate-700/80 rounded-lg p-1.5 px-2.5 text-[10px] text-slate-350 font-mono shadow-md max-w-xs truncate flex items-center gap-1.5 backdrop-blur-md">
            <span className="bg-emerald-400 w-1.5 h-1.5 rounded-full" />
            <span className="truncate">Blending alpha: {Math.round(opacity * 100)}%</span>
            <span className="text-slate-600">|</span>
            <span className="uppercase text-[9px] text-blue-400 font-bold">{format}</span>
          </div>
        )}
      </div>

      {/* Statistics board */}
      <div className="p-4 bg-slate-50 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs">
        <div>
          <span className="text-[9px] uppercase text-slate-400 font-bold tracking-wider block">Index Key</span>
          <span className="font-semibold text-slate-700 font-mono truncate block mt-0.5" title={selectedPair.name}>
            {selectedPair.name}
          </span>
        </div>
        <div>
          <span className="text-[9px] uppercase text-slate-400 font-bold tracking-wider block">Road Frame File</span>
          <span className="text-slate-600 font-mono truncate block mt-0.5 text-[11px]" title={selectedPair.originalFile.name}>
            {selectedPair.originalFile.name} ({formatFileSize(selectedPair.originalFile.size)})
          </span>
        </div>
        <div>
          <span className="text-[9px] uppercase text-slate-400 font-bold tracking-wider block">CVAT Label File</span>
          <span className="text-slate-600 font-mono truncate block mt-0.5 text-[11px]" title={selectedPair.maskFile.name}>
            {selectedPair.maskFile.name} ({formatFileSize(selectedPair.maskFile.size)})
          </span>
        </div>
      </div>
    </div>
  );
}

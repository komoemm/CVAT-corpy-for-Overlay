import { useState, useEffect, useMemo, useRef } from 'react';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import {
  Layers,
  Database,
  Play,
  CheckCircle2,
  AlertTriangle,
  FolderOpen,
  Info,
  Sliders,
  Sparkles,
  Download,
  Ban,
  Search,
  CheckCircle,
  XCircle,
  HelpCircle,
  FileImage,
  RefreshCw
} from 'lucide-react';

import {
  MatchedPair,
  ProcessingStats,
  ProcessingLog,
  ExportFormat,
  BlenderConfig
} from './types';
import { matchFiles, blendImages, getBaseName } from './utils/blender';
import FileSelector from './components/FileSelector';
import PreviewSection from './components/PreviewSection';
import ConsoleLog from './components/ConsoleLog';

export default function App() {
  // Config state
  const [config, setConfig] = useState<BlenderConfig>({
    opacity: 0.4,
    format: 'png',
    jpegQuality: 0.9,
    namingPattern: '[name]_overlay'
  });
  const [blackThreshold, setBlackThreshold] = useState<number>(0);

  // File lists state
  const [originalFiles, setOriginalFiles] = useState<File[]>([]);
  const [maskFiles, setMaskFiles] = useState<File[]>([]);
  const [matchedPairs, setMatchedPairs] = useState<MatchedPair[]>([]);
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<ProcessingStats>({
    total: 0,
    processed: 0,
    success: 0,
    failed: 0
  });
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  
  // Tab for list of files/unmatched files
  const [activeListTab, setActiveListTab] = useState<'matched' | 'unmatched-org' | 'unmatched-mask'>('matched');
  const [searchQuery, setSearchQuery] = useState('');

  // Cancellation ref
  const cancelProcessingRef = useRef<boolean>(false);

  // Helper to add a log line
  const addLog = (
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info'
  ) => {
    const timestamp = new Date().toLocaleTimeString();
    const newLog: ProcessingLog = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
      timestamp,
      message,
      type
    };
    setLogs((prev) => [...prev, newLog]);
  };

  // Re-match files automatically when original or mask files load
  useEffect(() => {
    if (originalFiles.length === 0 && maskFiles.length === 0) {
      setMatchedPairs([]);
      setSelectedPairId(null);
      return;
    }

    const matched = matchFiles(originalFiles, maskFiles);
    setMatchedPairs(matched);

    // Default select first pair
    if (matched.length > 0) {
      setSelectedPairId(matched[0].id);
      addLog(
        `File alignment completed. Successfully matched ${matched.length} dataset item pairs.`,
        'success'
      );
    } else if (originalFiles.length > 0 || maskFiles.length > 0) {
      addLog(
        `Scanned ${originalFiles.length} original frames and ${maskFiles.length} label mask files. No matching items found by raw base naming keys.`,
        'warning'
      );
    }
  }, [originalFiles, maskFiles]);

  // Compute unmatched files lists for diagnostics
  const unmatchedOriginals = useMemo(() => {
    if (originalFiles.length === 0) return [];
    const matchedNames = new Set(matchedPairs.map((p) => p.name));
    return originalFiles.filter((file) => {
      const relPath = (file as any).webkitRelativePath || file.name;
      return !matchedNames.has(getBaseName(relPath));
    });
  }, [originalFiles, matchedPairs]);

  const unmatchedMasks = useMemo(() => {
    if (maskFiles.length === 0) return [];
    const matchedNames = new Set(matchedPairs.map((p) => p.name));
    return maskFiles.filter((file) => {
      const relPath = (file as any).webkitRelativePath || file.name;
      return !matchedNames.has(getBaseName(relPath));
    });
  }, [maskFiles, matchedPairs]);

  // Get selected pair
  const selectedPair = useMemo(() => {
    return matchedPairs.find((p) => p.id === selectedPairId) || null;
  }, [matchedPairs, selectedPairId]);

  // Throttled UI status filtering
  const filteredPairs = useMemo(() => {
    return matchedPairs.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [matchedPairs, searchQuery]);

  const filteredUnmatchedOrg = useMemo(() => {
    return unmatchedOriginals.filter((file) => {
      const relPath = (file as any).webkitRelativePath || file.name;
      return getBaseName(relPath).includes(searchQuery.toLowerCase());
    });
  }, [unmatchedOriginals, searchQuery]);

  const filteredUnmatchedMask = useMemo(() => {
    return unmatchedMasks.filter((file) => {
      const relPath = (file as any).webkitRelativePath || file.name;
      return getBaseName(relPath).includes(searchQuery.toLowerCase());
    });
  }, [unmatchedMasks, searchQuery]);

  // Clear state functions
  const handleClearOriginals = () => {
    setOriginalFiles([]);
    addLog('Original road images lists flushed.', 'info');
  };

  const handleClearMasks = () => {
    setMaskFiles([]);
    addLog('CVAT labels mask images lists flushed.', 'info');
  };

  const handleCancel = () => {
    cancelProcessingRef.current = true;
    addLog('Cancellation command pushed. Terminating active thread...', 'warning');
  };

  // Main processing core loop
  const handleGenerateOverlays = async () => {
    if (matchedPairs.length === 0) {
      addLog('Cannot initiate bulk processing: No aligned matched image-mask pairs found.', 'error');
      return;
    }

    setIsProcessing(true);
    cancelProcessingRef.current = false;
    
    // Clear and initialize statistics
    setStats({
      total: matchedPairs.length,
      processed: 0,
      success: 0,
      failed: 0
    });

    // Reset status of all pairs to pending
    setMatchedPairs((prev) =>
      prev.map((p) => ({ ...p, status: 'pending', error: undefined }))
    );

    addLog(`Initiating post-processing loop for ${matchedPairs.length} paired files...`, 'info');
    addLog(`Config: Opacity = ${Math.round(config.opacity * 100)}% | Suffix = "${config.namingPattern}" | Format = ${config.format.toUpperCase()} (Black removal threshold: <= ${blackThreshold})`, 'info');

    const zip = new JSZip();
    let localProcessed = 0;
    let localSuccess = 0;
    let localFailed = 0;

    // Sequential loop for maximum memory efficiency and CPU thread friendliness
    for (let i = 0; i < matchedPairs.length; i++) {
      if (cancelProcessingRef.current) {
        addLog('Bulk blending job suspended by user command.', 'error');
        setIsProcessing(false);
        return;
      }

      const pair = matchedPairs[i];
      
      // Update individual file state to 'processing'
      setMatchedPairs((prev) =>
        prev.map((p) => (p.id === pair.id ? { ...p, status: 'processing' } : p))
      );

      try {
        // Run core blending computation
        const blendedBlob = await blendImages(
          pair.originalFile,
          pair.maskFile,
          config.opacity,
          config.format,
          config.jpegQuality,
          blackThreshold
        );

        // Determine destination file name inside the zip folder structure
        let finalFilename = config.namingPattern.replace('[name]', pair.name);
        if (!finalFilename) {
          finalFilename = `${pair.name}_blended`;
        }
        const ext = config.format === 'jpeg' ? 'jpg' : 'png';
        const fullOutputName = `${finalFilename}.${ext}`;

        // Add file directly to JSZip root
        zip.file(fullOutputName, blendedBlob);

        localSuccess++;
        // Update state to completed
        setMatchedPairs((prev) =>
          prev.map((p) => (p.id === pair.id ? { ...p, status: 'done' } : p))
        );
        addLog(`Blended image pair successfully: ${pair.name} → ${fullOutputName}`, 'success');

      } catch (err: any) {
        localFailed++;
        const errMsg = err?.message || 'Pixel blending runtime error.';
        console.error(`Error processing pair ${pair.name}:`, err);

        // Update pair with failure flag & message
        setMatchedPairs((prev) =>
          prev.map((p) => (p.id === pair.id ? { ...p, status: 'failed', error: errMsg } : p))
        );
        addLog(`Blend execution failed on element [${pair.name}]: ${errMsg}`, 'error');
      }

      localProcessed++;
      
      // Reactive progress update throttling
      setStats({
        total: matchedPairs.length,
        processed: localProcessed,
        success: localSuccess,
        failed: localFailed
      });

      // Give browser a frame to paint updates & collect standard variables
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Final ZIP Packing and dispatching
    if (localSuccess > 0) {
      addLog(`Consolidating dataset buffer to offline ZIP payload...`, 'info');
      
      try {
        const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
          // If we want detailed tracking on huge archives:
          if (metadata.percent % 25 === 0) {
            addLog(`Active Compression: ${Math.round(metadata.percent)}% complete.`, 'info');
          }
        });

        addLog(`ZIP container generated successfully. Spawning download trigger...`, 'success');
        saveAs(zipBlob, 'transparent_overlays.zip');
        addLog(`Archive download pipeline triggered ("transparent_overlays.zip"). Process completed cleanly.`, 'success');
      } catch (zipErr: any) {
        addLog(`ZIP export packer collapsed: ${zipErr?.message || zipErr}`, 'error');
      }
    } else {
      addLog(`No image combinations successfully compiled. ZIP export terminated.`, 'warning');
    }

    setIsProcessing(false);
  };

  // Auto logging context info on start
  useEffect(() => {
    addLog('Dataset Mask Blender workspace initialized.', 'info');
    addLog('This utility runs 100% locally in the sandbox. No asset leaves your device.', 'info');
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-700 flex flex-col antialiased selection:bg-blue-100">
      {/* Premium Top Navigation Rim */}
      <header className="border-b border-slate-200/80 bg-white sticky top-0 z-40 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <div className="w-full max-w-7xl mx-auto px-5 py-3.5 flex flex-col xs:flex-row xs:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-150 flex items-center justify-center text-blue-600">
              <Layers className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-800 flex items-center gap-2">
                Dataset Mask Blender
              </h1>
              <p className="text-[10px] text-slate-400 font-bold font-mono tracking-wider uppercase">
                LOCAL SEGMENTATION PRE-PROCESSOR &bull; CVAT Mask Format 1.1
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono bg-slate-100/80 p-1.5 px-3 border border-slate-200 rounded-lg max-w-max">
            <Database className="w-3.5 h-3.5 text-slate-400" />
            <span>Browser-Side Sandbox Engine (Zero Server Upload)</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-5 py-6 flex flex-col gap-5">
        
        {/* Row 1: The Input Handlers (Dual Columns) */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <FileSelector
            title="Original Dataset Images"
            description="Select or drop folder containing source highway/road RGB camera frames (.jpg, .png)"
            filesCount={originalFiles.length}
            filesSize={originalFiles.reduce((acc, f) => acc + f.size, 0)}
            onFilesSelected={setOriginalFiles}
            onClear={handleClearOriginals}
            accentColor="bg-blue-500"
          />

          <FileSelector
            title="CVAT Segmentation Labels"
            description="Select or drop folder of solid index colored masks with solid pure black [0,0,0] background"
            filesCount={maskFiles.length}
            filesSize={maskFiles.reduce((acc, f) => acc + f.size, 0)}
            onFilesSelected={setMaskFiles}
            onClear={handleClearMasks}
            accentColor="bg-blue-500"
          />
        </section>

        {/* Dynamic Statistics Block */}
        {(originalFiles.length > 0 || maskFiles.length > 0) && (
          <section className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 shadow-sm">
            <div className="border-r border-slate-100 p-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Unprocessed Originals</span>
              <span className="text-lg font-bold block mt-0.5 font-mono text-slate-750">{originalFiles.length}</span>
            </div>
            <div className="border-r border-slate-100 p-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Unprocessed Masks</span>
              <span className="text-lg font-bold block mt-0.5 font-mono text-slate-750">{maskFiles.length}</span>
            </div>
            <div className="border-r border-slate-100 p-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Matched Aligned Pairs</span>
              <span className="text-lg font-bold block mt-0.5 font-mono text-emerald-600">{matchedPairs.length}</span>
            </div>
            <div className="p-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Matching Sync Rate</span>
              <span className="text-lg font-bold block mt-0.5 font-mono text-blue-600">
                {originalFiles.length > 0 ? Math.round((matchedPairs.length / originalFiles.length) * 100) : 0}%
              </span>
            </div>
          </section>
        )}

        {/* Row 2: Parameters Grid Panel */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
            <Sliders className="w-4 h-4 text-blue-600" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">Blender Compositor settings</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            {/* Opacity Control */}
            <div className="flex flex-col justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg gap-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-705 flex items-center gap-1.5">
                  Mask Opacity Overlay
                </label>
                <span className="font-mono text-xs text-blue-600 font-bold bg-blue-50 p-0.5 px-2 rounded-md border border-blue-105">
                  {Math.round(config.opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(config.opacity * 100)}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, opacity: parseFloat(e.target.value) / 100 }))
                }
                className="w-full accent-blue-600 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer mt-2"
              />
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Alpha value applied to non-black segmented layers overlay.
              </p>
            </div>

            {/* Pure Black Detection Tolerance */}
            <div className="flex flex-col justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg gap-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-705 flex items-center gap-1.5" title="Removes dark compression noise elements">
                  Black Mask Crop Threshold
                </label>
                <span className="font-mono text-xs text-blue-600 font-bold bg-blue-50 p-0.5 px-2 rounded-md border border-blue-105">
                  &le; {blackThreshold}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="40"
                value={blackThreshold}
                onChange={(e) => setBlackThreshold(parseInt(e.target.value))}
                className="w-full accent-blue-600 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer mt-2"
              />
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Allows removing pixel indices containing faint JPEG compression noise (Default 0).
              </p>
            </div>

            {/* Target Export Format */}
            <div className="flex flex-col justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg gap-2">
              <label className="text-xs font-bold text-slate-705">File Output Format</label>
              
              <div className="flex border border-slate-200 bg-white p-1 rounded-lg mt-1">
                <button
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, format: 'png' }))}
                  className={`flex-1 text-center py-1 rounded text-xs font-bold uppercase font-mono transition-all cursor-pointer ${
                    config.format === 'png'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  PNG
                </button>
                <button
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, format: 'jpeg' }))}
                  className={`flex-1 text-center py-1 rounded text-xs font-bold uppercase font-mono transition-all cursor-pointer ${
                    config.format === 'jpeg'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  JPEG
                </button>
              </div>

              {config.format === 'jpeg' ? (
                <div className="mt-2 flex flex-col gap-1">
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>JPEG Quality:</span>
                    <span className="font-mono">{Math.round(config.jpegQuality * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    value={Math.round(config.jpegQuality * 100)}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, jpegQuality: parseInt(e.target.value) / 100 }))
                    }
                    className="w-full accent-blue-600 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              ) : (
                <p className="text-[10px] text-slate-400">
                  Lossless PNG format with full crisp boundaries (Recommended).
                </p>
              )}
            </div>

            {/* Target Filename Naming Pattern Template */}
            <div className="flex flex-col justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg gap-2">
              <label className="text-xs font-bold text-slate-705">ZIP File Naming Scheme</label>
              
              <div className="relative mt-1">
                <input
                  type="text"
                  value={config.namingPattern}
                  onChange={(e) => setConfig((prev) => ({ ...prev, namingPattern: e.target.value }))}
                  className="w-full bg-white text-slate-700 border border-slate-205 rounded-lg px-2.5 py-1 text-xs font-mono outline-none focus:border-blue-600 transition-colors"
                  placeholder="[name]_blended"
                />
              </div>

              <div className="flex flex-col gap-0.5">
                <p className="text-[10px] text-slate-400 font-sans">
                  Use <code className="font-mono text-blue-600">[name]</code> for source index.
                </p>
                <p className="text-[9px] text-slate-400 font-mono truncate">
                  E.g., <code className="font-mono">img_02</code> &rarr; <code className="font-mono font-bold text-slate-600">img_02_overlay.{config.format === 'jpeg' ? 'jpg' : 'png'}</code>
                </p>
              </div>
            </div>

          </div>
        </section>        {/* Row 3: Live Previewer Canvas & File Index Inspector */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          
          {/* Interactive Preview Canvas - 7/12 layout columns */}
          <div className="lg:col-span-7 flex flex-col gap-2.5">
            <h3 className="text-[11.5px] font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 px-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              Dynamic Compositor Canvas Preview
            </h3>
            
            <PreviewSection
              selectedPair={selectedPair}
              opacity={config.opacity}
              format={config.format}
              jpegQuality={config.jpegQuality}
              blackThreshold={blackThreshold}
            />
          </div>

          {/* Dataset Aligned File Pairs Manager - 5/12 layout columns */}
          <div className="lg:col-span-5 flex flex-col gap-2.5 h-full">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[11.5px] font-bold text-slate-400 tracking-wider uppercase">
                Aligned Index Directory Explorer
              </h3>
              
              {matchedPairs.length > 0 && (
                <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 font-mono px-2 py-0.5 rounded-full font-bold">
                  {matchedPairs.length} matches
                </span>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col h-[460px] shadow-sm">
              
              {/* Explorer Tab Controls */}
              <div className="flex bg-slate-50 border-b border-slate-200 p-1 shrink-0">
                <button
                  onClick={() => {
                    setActiveListTab('matched');
                    setSearchQuery('');
                  }}
                  className={`flex-1 py-1.5 text-center text-xs font-bold rounded transition-all cursor-pointer ${
                    activeListTab === 'matched' ? 'bg-white text-slate-800 border border-slate-200/50 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Matches
                </button>
                <button
                  onClick={() => {
                    setActiveListTab('unmatched-org');
                    setSearchQuery('');
                  }}
                  className={`flex-1 py-1.5 text-center text-xs font-bold rounded transition-all relative cursor-pointer ${
                    activeListTab === 'unmatched-org' ? 'bg-white text-slate-800 border border-slate-200/50 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Unpaired Road
                  {unmatchedOriginals.length > 0 && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  )}
                </button>
                <button
                  onClick={() => {
                    setActiveListTab('unmatched-mask');
                    setSearchQuery('');
                  }}
                  className={`flex-1 py-1.5 text-center text-xs font-bold rounded transition-all relative cursor-pointer ${
                    activeListTab === 'unmatched-mask' ? 'bg-white text-slate-800 border border-slate-200/50 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Unpaired Label
                  {unmatchedMasks.length > 0 && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  )}
                </button>
              </div>

              {/* Index filter bar */}
              <div className="p-2.5 border-b border-slate-100 bg-slate-50/50 flex gap-2 items-center shrink-0">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-2.5 flex items-center text-slate-400">
                    <Search className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      activeListTab === 'matched'
                        ? 'Search aligned matches...'
                        : activeListTab === 'unmatched-org'
                        ? 'Search unmatched road frames...'
                        : 'Search unmatched label masks...'
                    }
                    className="w-full bg-white text-slate-700 border border-slate-200 rounded-lg pl-8 pr-3 py-1 text-xs outline-none focus:border-blue-600 transition-colors"
                  />
                </div>
              </div>

              {/* Data Content Board */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-slate-5/30">
                {activeListTab === 'matched' ? (
                  filteredPairs.length === 0 ? (
                    <div className="text-slate-400 text-center py-12 text-xs flex flex-col items-center justify-center p-4">
                      <HelpCircle className="w-7 h-7 opacity-50 mb-1.5 animate-pulse" />
                      <span>{matchedPairs.length === 0 ? 'Upload folders above to begin alignment indexed pairing.' : 'No matched keys match your text query.'}</span>
                    </div>
                  ) : (
                    filteredPairs.map((pair) => {
                      const isSelected = pair.id === selectedPairId;
                      return (
                        <button
                          key={pair.id}
                          onClick={() => setSelectedPairId(pair.id)}
                          className={`w-full text-left p-2 px-2.5 rounded-lg transition-all flex items-center justify-between text-xs cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'hover:bg-slate-100 border border-transparent text-slate-700'
                          }`}
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className={`font-mono font-bold truncate ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                              {pair.name}
                            </span>
                            <span className={`text-[10px] truncate font-mono mt-0.5 ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                              {pair.originalFile.name} &bull; {pair.maskFile.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {pair.status === 'processing' && (
                              <span className={`text-[9px] font-mono flex items-center gap-1 ${isSelected ? 'text-white' : 'text-blue-600'}`}>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Processing
                              </span>
                            )}
                            {pair.status === 'done' && (
                              <span className={`text-[9px] font-mono flex items-center gap-1 ${isSelected ? 'text-white' : 'text-emerald-700 font-semibold'}`}>
                                <CheckCircle className="w-3.5 h-3.5" />
                                Complete
                              </span>
                            )}
                            {pair.status === 'failed' && (
                              <span className="text-[9px] text-red-500 font-mono flex items-center gap-1" title={pair.error}>
                                <XCircle className="w-3.5 h-3.5" />
                                Failed
                              </span>
                            )}
                            {pair.status === 'pending' && (
                              <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-white' : 'bg-slate-350'}`} />
                            )}
                          </div>
                        </button>
                      );
                    })
                  )
                ) : activeListTab === 'unmatched-org' ? (
                  filteredUnmatchedOrg.length === 0 ? (
                    <div className="text-slate-400 text-center py-12 text-xs flex flex-col items-center justify-center p-4">
                      <CheckCircle2 className="w-7 h-7 opacity-50 text-emerald-500 mb-1.5" />
                      <span>No unmatched original frames. All frames matched nicely.</span>
                    </div>
                  ) : (
                    filteredUnmatchedOrg.map((file, idx) => (
                      <div
                        key={idx}
                        className="p-2 px-3 rounded-lg border border-slate-200 bg-white flex items-center justify-between text-xs"
                      >
                        <span className="font-mono text-slate-600 truncate animate-fade-in" title={(file as any).webkitRelativePath || file.name}>
                          {(file as any).webkitRelativePath || file.name}
                        </span>
                        <span className="text-[9px] text-amber-700 font-mono bg-amber-50 p-1 px-1.5 rounded border border-amber-100 flex items-center gap-1 font-semibold">
                          <AlertTriangle className="w-3 h-3" /> No label
                        </span>
                      </div>
                    ))
                  )
                ) : (
                  filteredUnmatchedMask.length === 0 ? (
                    <div className="text-slate-400 text-center py-12 text-xs flex flex-col items-center justify-center p-4">
                      <CheckCircle2 className="w-7 h-7 opacity-50 text-emerald-500 mb-1.5" />
                      <span>No unmatched masks. All labels matched properly.</span>
                    </div>
                  ) : (
                    filteredUnmatchedMask.map((file, idx) => (
                      <div
                        key={idx}
                        className="p-2 px-3 rounded-lg border border-slate-200 bg-white flex items-center justify-between text-xs"
                      >
                        <span className="font-mono text-slate-600 truncate animate-fade-in" title={(file as any).webkitRelativePath || file.name}>
                          {(file as any).webkitRelativePath || file.name}
                        </span>
                        <span className="text-[9px] text-amber-700 font-mono bg-amber-50 p-1 px-1.5 rounded border border-amber-100 flex items-center gap-1 font-semibold">
                          <AlertTriangle className="w-3 h-3" /> No original
                        </span>
                      </div>
                    ))
                  )
                )}
              </div>

              {/* Diagnostic footer help card */}
              <div className="p-3 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-400 leading-relaxed font-sans shrink-0 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>Tip for CVAT Exports:</strong> Original images can be in PNG, JPG formats. Naming coordinates matched cleanly on lowercase string comparison.
                </span>
              </div>            </div>
          </div>
        </section>

        {/* Row 4: Async Processing Engine Hub (Controls, Progress & Console Logs) */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-5 shadow-sm">
          
          {/* Main Action Banner */}
          <div className="xs:flex xs:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="mb-3 xs:mb-0">
              <h3 className="text-xs font-bold text-slate-700 tracking-wider uppercase flex items-center gap-1.5">
                <Database className="w-4 h-4 text-slate-500" />
                Asynchronous Engine Bulk Compiler
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-lg leading-relaxed">
                Applies the blender compositing matrix sequentially across all paired items, adds transparent overlays directly to the ZIP, and triggers the download.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {isProcessing ? (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-bold text-xs transition-all tracking-wide active:scale-95 cursor-pointer shadow-sm"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Cancel Queue
                </button>
              ) : (
                <button
                  type="button"
                  disabled={matchedPairs.length === 0}
                  onClick={handleGenerateOverlays}
                  className={`flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg font-bold text-xs tracking-wider uppercase transition-all shadow-sm active:scale-98 cursor-pointer ${
                    matchedPairs.length === 0
                      ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" />
                  Generate & Export ZIP
                </button>
              )}
            </div>
          </div>

          {/* Core progress layout (when processing) */}
          {isProcessing && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-blue-600 font-mono animate-pulse uppercase tracking-wider text-[11px] flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
                  Compiling Overlay Stack...
                </span>
                <span className="font-mono text-slate-500 text-[11px] font-bold">
                  Processed {stats.processed} of {stats.total} items ({Math.round((stats.processed / stats.total) * 100)}%)
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200/80 h-2 rounded-full overflow-hidden border border-slate-300/40">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-150"
                  style={{ width: `${(stats.processed / stats.total) * 100}%` }}
                />
              </div>

              {/* Mini statistic readouts */}
              <div className="grid grid-cols-3 gap-2 text-center text-[10.5px] font-mono mt-1">
                <div className="bg-white p-2 rounded-md border border-slate-200 text-emerald-700 font-bold">
                  <span>Succeeded: {stats.success}</span>
                </div>
                <div className="bg-white p-2 rounded-md border border-slate-200 text-red-600 font-bold">
                  <span>Failed: {stats.failed}</span>
                </div>
                <div className="bg-white p-2 rounded-md border border-slate-200 text-slate-500 font-bold">
                  <span>Remaining: {stats.total - stats.processed}</span>
                </div>
              </div>
            </div>
          )}

          {/* Logs Console Container */}
          <ConsoleLog logs={logs} onClear={() => setLogs([])} />

        </section>

      </main>

      {/* Aesthetic humanized footer tag limits */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-5">
        <div className="w-full max-w-7xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400 text-center sm:text-left">
          <p className="font-sans">
            Designed for post-processing AI Computer Vision Road Datasets securely.
          </p>
          <p className="font-mono text-[10px] font-semibold text-slate-405">
            CVAT Segmentation mask blending algorithm &bull; 100% Offline Client-Side Engine
          </p>
        </div>
      </footer>
    </div>
  );
}

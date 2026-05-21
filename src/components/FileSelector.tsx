import React, { useRef, useState } from 'react';
import { FolderOpen, FileUp, Hash, CheckCircle, Trash2, HelpCircle } from 'lucide-react';

interface FileSelectorProps {
  title: string;
  description: string;
  filesCount: number;
  filesSize: number;
  onFilesSelected: (files: File[]) => void;
  onClear: () => void;
  accentColor: string;
}

export default function FileSelector({
  title,
  description,
  filesCount,
  filesSize,
  onFilesSelected,
  onClear,
  accentColor,
}: FileSelectorProps) {
  const [dragActive, setDragActive] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const items: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      // Only include images
      if (file.type.startsWith('image/') || 
          file.name.endsWith('.jpg') || 
          file.name.endsWith('.jpeg') || 
          file.name.endsWith('.png') || 
          file.name.endsWith('.bmp') || 
          file.name.endsWith('.tiff') || 
          file.name.endsWith('.webp')) {
        items.push(file);
      }
    }
    onFilesSelected(items);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed transition-all p-5 bg-white 
        ${
          filesCount > 0
            ? 'border-emerald-550 shadow-[0_1px_3px_rgba(16,185,129,0.05)] bg-[#fcfdfd]'
            : dragActive
            ? 'border-blue-500 bg-blue-50/20 shadow-sm scale-[1.01]'
            : 'border-slate-200 hover:border-slate-350 hover:bg-slate-50/50'
        }`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      <div className="flex flex-col h-full justify-between gap-4">
        <div>
          <div className="flex items-start justify-between">
            <h3 className="text-sm font-bold text-slate-800 tracking-tight flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${filesCount > 0 ? 'bg-emerald-500' : accentColor}`} />
              {title}
            </h3>
            {filesCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="text-slate-400 hover:text-red-500 p-1 rounded-lg hover:bg-slate-100 transition-all cursor-pointer"
                title="Remove files"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</p>
        </div>

        {filesCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-5 text-center">
            <div className="flex gap-3 items-center mb-3">
              {/* Folder Selector */}
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors shadow-sm active:scale-95 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Select Folder
              </button>

              {/* Multi File Selector */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 font-semibold text-xs transition-colors active:scale-95 cursor-pointer"
              >
                <FileUp className="w-3.5 h-3.5" />
                Select Files
              </button>
            </div>

            <p className="text-[11px] text-slate-400">
              Or drag & drop directory / files here
            </p>
            
            {/* Folder Input Element (Hidden) */}
            <input
              type="file"
              ref={folderInputRef}
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
              multiple
              {...({ webkitdirectory: '', directory: '' } as any)}
            />

            {/* Standard File Input Element (Hidden) */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
              multiple
              accept="image/*"
            />
          </div>
        ) : (
          <div className="py-3 bg-slate-50 border border-slate-100 rounded-lg p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 flex items-center gap-1 font-medium">
                <Hash className="w-3.5 h-3.5 text-slate-400" />
                Scanned Images
              </span>
              <span className="font-mono text-emerald-600 font-semibold text-sm">
                {filesCount} files
              </span>
            </div>
            
            <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full rounded-full w-full" />
            </div>

            <div className="flex justify-between items-center text-[11px] text-slate-400 font-mono">
              <span>Total size:</span>
              <span>{formatSize(filesSize)}</span>
            </div>
            
            <div className="flex items-center gap-1.5 text-emerald-700 text-xs mt-0.5 bg-emerald-50 border border-emerald-100 rounded-lg p-2 font-medium">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              <span className="truncate">Loaded & parsed successfully.</span>
            </div>
          </div>
        )}
        
        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
          <HelpCircle className="w-3 h-3 text-slate-300" />
          <span>Supports road dataset sub-directories smoothly.</span>
        </div>
      </div>
    </div>
  );
}

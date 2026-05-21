export type BlendStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface MatchedPair {
  id: string;
  name: string; // Base filename without path or extension (lowercase)
  originalFile: File;
  maskFile: File;
  originalPath: string;
  maskPath: string;
  status: BlendStatus;
  error?: string;
  size?: number; // combined size in bytes or original size
}

export interface ProcessingStats {
  total: number;
  processed: number;
  success: number;
  failed: number;
}

export interface ProcessingLog {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export type ExportFormat = 'png' | 'jpeg';

export interface BlenderConfig {
  opacity: number; // 0.0 to 1.0
  format: ExportFormat;
  jpegQuality: number; // 0.1 to 1.0
  namingPattern: string; // e.g., '[name]_blended', '[name]'
}

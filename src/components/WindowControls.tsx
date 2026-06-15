import { Maximize2, X, Lock } from 'lucide-react';
import { useState } from 'react';

interface WindowControlsProps {
  disabledClose?: boolean;
}

export default function WindowControls({ disabledClose = false }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [showLockIndicator, setShowLockIndicator] = useState(false);

  const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

  const handleToggleMaximize = async () => {
    await api?.toggleMaximizeWindow?.();
    setIsMaximized((prev) => !prev);
  };

  const handleClose = async () => {
    if (disabledClose) {
      setShowLockIndicator(true);
      setTimeout(() => setShowLockIndicator(false), 2000);
      return;
    }
    await api?.closeWindow?.();
  };

  return (
    <div className="flex items-center gap-2">
      {showLockIndicator && (
        <div className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-1.5 rounded-full border border-red-200 flex items-center gap-1">
          <Lock className="w-3 h-3" />
          Window locked
        </div>
      )}
      <button
        onClick={handleToggleMaximize}
        className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition"
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        <Maximize2 className="w-4 h-4" />
      </button>
      <button
        onClick={handleClose}
        disabled={disabledClose}
        className={`w-8 h-8 rounded-full ${disabledClose 
          ? 'bg-red-100 text-red-400 cursor-not-allowed' 
          : 'bg-red-50 hover:bg-red-100 text-red-600'} flex items-center justify-center transition`}
        title={disabledClose ? "Close disabled - complete plan flow to unlock" : "Close"}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

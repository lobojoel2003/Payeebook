import { useRef, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';

export function FileDrop({
  accept,
  multiple,
  onFiles,
  title,
  hint,
  icon,
  children,
  testId,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <div className="dz-icon">{icon ?? <Upload size={22} />}</div>
      <h3>{title}</h3>
      {hint && (
        <p className="muted small" style={{ marginTop: 4 }}>
          {hint}
        </p>
      )}
      <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
        <button className="btn btn-primary" type="button" onClick={() => input.current?.click()}>
          <Upload size={16} /> Choose file{multiple ? 's' : ''}
        </button>
        {children}
      </div>
      <input
        ref={input}
        data-testid={testId}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

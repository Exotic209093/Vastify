import { useEffect, useState } from 'react';
import { animate } from 'framer-motion';

interface Props {
  to: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export default function AnimatedCounter({ to, duration = 2.5, prefix = '', suffix = '', className = '' }: Props) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const ctrl = animate(0, to, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setVal(Math.round(v)),
    });
    return () => ctrl.stop();
  }, [to, duration]);
  return <span className={className}>{prefix}{val.toLocaleString()}{suffix}</span>;
}

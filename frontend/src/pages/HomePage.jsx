import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/** 首页直接进入预约页 */
export function HomePage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/book', { replace: true });
  }, [navigate]);
  return null;
}

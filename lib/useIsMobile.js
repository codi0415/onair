"use client";

import { useState, useEffect } from "react";

// 768px 미만을 모바일로 취급합니다. 서버 렌더링 시점에는 창 크기를 알 수 없으므로
// 기본값은 false(데스크톱)로 시작하고, 클라이언트에서 마운트된 뒤 실제 폭을 반영합니다.
export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < breakpoint);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);

  return isMobile;
}

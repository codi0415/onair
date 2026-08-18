import { NextResponse } from "next/server";
import { searchAllTracks } from "@/lib/search";

const MAX_QUERY_LENGTH = 100;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.trim().length < 1) {
    return NextResponse.json({ tracks: [] });
  }

  // 검색어는 곡명/아티스트명이라 100자면 충분합니다. 지나치게 긴 입력은 잘라서
  // 캐시 키가 무한정 늘어나거나 외부 API에 이상한 요청이 나가지 않도록 합니다.
  const term = q.trim().slice(0, MAX_QUERY_LENGTH);

  // iTunes와 Deezer를 병행 검색해서 결과를 합칩니다 (같은 곡은 한 번만 노출).
  // 개별 소스 오류는 lib/search.js와 각 lib 내부에서 이미 부드럽게 처리되지만,
  // 검색은 학생 화면의 핵심 기능이라 여기서도 마지막으로 한 번 더 감쌉니다.
  try {
    // 소스별 개수/최종 개수는 lib/search.js가 정합니다.
    // (limit을 올려도 API 호출 횟수는 그대로라 레이트 리밋에는 영향이 없습니다.)
    const { tracks, notice } = await searchAllTracks(term);
    return NextResponse.json({ tracks, notice: notice || undefined });
  } catch (err) {
    console.error("검색 처리 실패:", err);
    return NextResponse.json({
      tracks: [],
      notice: "곡 검색 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.",
    });
  }
}

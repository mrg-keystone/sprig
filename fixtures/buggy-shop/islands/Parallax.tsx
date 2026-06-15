export default function Parallax() {
  const dots = Array.from({ length: 40 }, (_, i) => i);

  // Scroll handler attached during render: non-passive, unthrottled, and it reads
  // layout (getBoundingClientRect) then writes style for every dot on every scroll
  // event — forced synchronous layout / reflow storm. Also never removed (leak).
  if (typeof document !== "undefined") {
    addEventListener("scroll", () => {
      const els = document.querySelectorAll<HTMLElement>(".dot");
      els.forEach((el) => {
        const rect = el.getBoundingClientRect();
        el.style.transform = `translateY(${rect.top * -0.05}px)`;
      });
    });
  }

  return (
    <div class="parallax" aria-hidden="true">
      {dots.map((i) => <div key={i} class="dot" />)}
    </div>
  );
}

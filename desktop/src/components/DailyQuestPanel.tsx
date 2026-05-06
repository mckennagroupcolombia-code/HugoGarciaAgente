export default function DailyQuestPanel() {
  return (
    <div className="-mx-4 -my-5 lg:-mx-10 lg:-my-8">
      <iframe
        src="/app/daily-quest.html"
        title="Daily Quest — Crónicas de las Rutinas"
        className="w-full border-0 block"
        style={{ height: "calc(100vh - 96px)" }}
        allow="clipboard-write"
      />
    </div>
  );
}

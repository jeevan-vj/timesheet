import { formatDayHeading, formatShiftTime, shiftStatusLabel, type OwnerEntry } from "@cleantrack/core";
import { ListRow, StatusPill } from "@/ui";

export function OwnerShiftRow({
  entry,
  onPress,
  showContractor,
}: {
  entry: OwnerEntry;
  onPress?: () => void;
  showContractor: boolean;
}) {
  const status = shiftStatusLabel(entry.occurrenceKind);
  const when = formatShiftTime(entry);
  const subtitle = showContractor ? `${entry.contractorName} · ${when}` : `${formatDayHeading(entry.workDate)} · ${when}`;
  return (
    <ListRow
      accessibilityLabel={`${entry.siteName}, ${subtitle}, ${status}`}
      icon={{ ios: "clock", android: "schedule", web: "schedule" }}
      onPress={onPress}
      subtitle={subtitle}
      title={entry.siteName}
      trailing={<StatusPill label={status} />}
    />
  );
}

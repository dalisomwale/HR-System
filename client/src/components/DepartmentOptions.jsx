/**
 * <option> elements for a department dropdown, grouped under each company's name so two
 * companies' "Finance" departments can be told apart. Departments with no company yet come last.
 */
export default function DepartmentOptions({ departments }) {
  const groups = new Map();
  for (const d of departments) {
    const key = d.company ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const names = [...groups.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));
  return names.map((company) => (
    <optgroup key={company || 'none'} label={company || 'No company set'}>
      {groups
        .get(company)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
    </optgroup>
  ));
}

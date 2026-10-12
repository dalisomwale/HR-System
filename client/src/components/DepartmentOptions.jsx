/** <option> elements for a department dropdown: department names only, in alphabetical order. */
export default function DepartmentOptions({ departments }) {
  return [...departments]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => (
      <option key={d.id} value={d.id}>
        {d.name}
      </option>
    ));
}

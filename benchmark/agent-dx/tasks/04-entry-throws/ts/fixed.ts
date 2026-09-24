export function getName(user: { name: string }): string {
  return user.name;
}
getName({ name: "ada" });

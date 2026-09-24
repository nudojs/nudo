interface User {
  id: number;
  name: string;
}

function greet(u: User): string {
  return u.name + "!";
}

greet({ id: 2, name: "ada" });

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

type GraphQLPayload = {
  query?: string;
};

type HealthPayload = {
  ok: true;
  service: "veydrift-backend";
};

const healthPayload: HealthPayload = {
  ok: true,
  service: "veydrift-backend"
};

export function createRequestHandler(): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(healthPayload, {
        headers: jsonHeaders
      });
    }

    if (request.method === "POST" && url.pathname === "/graphql") {
      return handleGraphQLRequest(request);
    }

    if (request.method === "GET" && url.pathname === "/graphql") {
      return Response.json(
        {
          data: {
            service: {
              name: "Veydrift",
              status: "coming-soon"
            }
          }
        },
        {
          headers: jsonHeaders
        }
      );
    }

    return Response.json(
      {
        error: "not_found"
      },
      {
        headers: jsonHeaders,
        status: 404
      }
    );
  };
}

async function handleGraphQLRequest(request: Request): Promise<Response> {
  let payload: GraphQLPayload;

  try {
    payload = (await request.json()) as GraphQLPayload;
  } catch {
    return Response.json(
      {
        errors: [
          {
            message: "Request body must be valid JSON."
          }
        ]
      },
      {
        headers: jsonHeaders,
        status: 400
      }
    );
  }

  if (!payload.query || !payload.query.trim()) {
    return Response.json(
      {
        errors: [
          {
            message: "GraphQL query is required."
          }
        ]
      },
      {
        headers: jsonHeaders,
        status: 400
      }
    );
  }

  return Response.json(
    {
      data: {
        service: {
          name: "Veydrift",
          status: "coming-soon"
        }
      }
    },
    {
      headers: jsonHeaders
    }
  );
}

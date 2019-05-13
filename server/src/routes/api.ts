import { getDefaultProvider } from 'ethers';
import { FastifyInstance } from 'fastify';
import createError from 'http-errors';
import { getEvent, getEventByFancyId, getEvents, updateEvent } from '../db';
import { getAllTokens, getTokenInfo, mintToken, mintTokens, verifyClaim } from '../poap-helper';
import { Claim, PoapEvent } from '../types';

function buildMetadataJson(tokenUrl: string, ev: PoapEvent) {
  return {
    description: ev.description,
    external_url: tokenUrl,
    home_url: tokenUrl,
    image: ev.image_url,
    image_url: ev.image_url,
    name: ev.name,
    year: ev.year,
    tags: ['poap', 'event'],
    attributes: [
      {
        trait_type: 'startDate',
        value: ev.start_date,
      },
      {
        trait_type: 'endDate',
        value: ev.end_date,
      },
      {
        trait_type: 'city',
        value: ev.city,
      },
      {
        trait_type: 'country',
        value: ev.country,
      },
      {
        trait_type: 'eventURL',
        value: ev.event_url,
      },
    ],
    properties: [],
  };
}

export default async function routes(fastify: FastifyInstance) {
  fastify.addSchema({
    $id: 'address',
    type: 'string',
    minLength: 42,
    maxLength: 42,
    pattern: '^0x[0-9a-fA-F]{40}$',
  });

  fastify.addSchema({
    $id: 'signature',
    type: 'string',
    minLength: 132,
    maxLength: 132,
    pattern: '^0x[0-9a-fA-F]{130}$',
  });

  fastify.get('/metadata/:eventId/:tokenId', async (req, res) => {
    const event = await getEvent(parseInt(req.params.eventId));
    if (!event) {
      throw new createError.NotFound('Invalid Event');
    }
    const tokenUrl = `http://localhost:3000/metadata/${req.params.eventId}/${req.params.tokenId}`;
    return buildMetadataJson(tokenUrl, event);
  });

  fastify.get(
    '/api/ens_resolve',
    {
      schema: {
        querystring: {
          name: { type: 'string' },
        },
      },
    },
    async (req, res) => {
      const mainnetProvider = getDefaultProvider('homestead');

      if (req.query['name'] == null || req.query['name'] == '') {
        throw new createError.BadRequest('"name" query parameter is required');
      }

      const resolvedAddress = await mainnetProvider.resolveName(req.query['name']);

      if (resolvedAddress == null) {
        return {
          valid: false,
        };
      } else {
        return {
          valid: true,
          address: resolvedAddress,
        };
      }
    }
  );

  fastify.get(
    '/api/scan/:address',
    {
      schema: {
        params: {
          address: 'address#',
        },
      },
    },
    async (req, res) => {
      const address = req.params.address;
      const tokens = await getAllTokens(address);
      return tokens;
    }
  );

  fastify.get(
    '/api/token/:tokenId',
    {
      schema: {
        params: {
          tokenId: { type: 'integer' },
        },
      },
    },
    async (req, res) => {
      const tokenId = req.params.tokenId;
      const tokenInfo = await getTokenInfo(tokenId);
      return tokenInfo;
    }
  );

  fastify.get('/api/events', async (req, res) => {
    const events = await getEvents();
    return events;
  });

  fastify.get(
    '/api/events/:fancyid',
    {
      schema: {
        params: {
          fancyid: { type: 'string' },
        },
      },
    },
    async (req, res) => {
      const event = await getEventByFancyId(req.params.fancyid);
      if (!event) {
        return new createError.NotFound('Invalid Event');
      }
      return event;
    }
  );

  fastify.put(
    '/api/events/:fancyid',
    {
      preValidation: [fastify.authenticate],
      schema: {
        params: {
          fancyid: { type: 'string' },
        },
        body: {
          type: 'object',
          required: ['signer', 'signer_ip', 'event_url', 'image_url'],
          properties: {
            signer: { anyOf: ['address#', { type: 'null' }] },
            signer_ip: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            event_url: { type: 'string' },
            image_url: { type: 'string' },
          },
        },
      },
    },
    async (req, res) => {
      const isOk = await updateEvent(req.params.fancyid, {
        signer: req.body.signer,
        signer_ip: req.body.signer_ip,
        event_url: req.body.event_url,
        image_url: req.body.image_url,
      });
      if (!isOk) {
        return new createError.NotFound('Invalid event');
      }
      res.status(204);
      return;
    }
  );
  fastify.post(
    '/api/mintTokenBatch',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['eventId', 'addresses'],
          properties: {
            eventId: { type: 'integer', minimum: 1 },
            addresses: {
              type: 'array',
              minItems: 1,
              items: 'address#',
            },
          },
        },
      },
    },
    async (req, res) => {
      await mintTokens(req.body.eventId, req.body.addresses);
      res.status(204);
      return;
    }
  );

  fastify.post(
    '/api/claim',
    {
      schema: {
        body: {
          type: 'object',
          required: ['claimId', 'eventId', 'proof', 'claimer', 'claimerSignature'],
          properties: {
            claimId: { type: 'string' },
            eventId: { type: 'integer', minimum: 1 },
            proof: 'signature#',
            claimer: 'address#',
            claimerSignature: 'signature#',
          },
        },
      },
    },
    async (req, res) => {
      const claim: Claim = req.body;
      const isValid = await verifyClaim(claim);
      if (isValid) {
        await mintToken(claim.eventId, claim.claimer);
        res.status(204);
      } else {
        throw new createError.BadRequest('Invalid Claim');
      }
    }
  );
}
